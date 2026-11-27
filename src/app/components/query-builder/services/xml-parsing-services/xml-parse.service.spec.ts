import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { XmlParseService } from './xml-parse.service';
import { NodeTreeService } from '../node-tree.service';
import { QueryRenderService } from '../query-render.service';
import { QueryNode } from '../../models/query-node';
import { provideQueryBuilderTesting } from '../query-builder-test-providers';

describe('XmlParseService', () => {
  let parseService: XmlParseService;
  let nodeTreeService: NodeTreeService;
  let renderService: QueryRenderService;
  let view: EditorView;

  function parse(text: string): void {
    view?.destroy();
    view = new EditorView({ state: EditorState.create({ doc: text, extensions: [xml()] }) });
    parseService.parseXmlManually(view);
  }

  function nodes(): QueryNode[] {
    return [...nodeTreeService.getNodeTree().value];
  }

  function attributesOf(node: QueryNode): { [name: string]: string } {
    const result: { [name: string]: string } = {};
    for (const attribute of node.attributes$.value) {
      result[attribute.editorName] = attribute.value$.value;
    }
    return result;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideQueryBuilderTesting() });
    parseService = TestBed.inject(XmlParseService);
    nodeTreeService = TestBed.inject(NodeTreeService);
    // Instantiated as in the app: it re-renders the XML when the tree changes.
    renderService = TestBed.inject(QueryRenderService);
  });

  afterEach(() => view?.destroy());

  it('builds the node tree with names, levels and parents', fakeAsync(() => {
    parse([
      '<fetch top="5">',
      '  <entity name="account">',
      '    <attribute name="name" />',
      '    <filter type="and">',
      '      <condition attribute="statecode" operator="eq" value="0" />',
      '    </filter>',
      '  </entity>',
      '</fetch>',
    ].join('\n'));

    const tree = nodes();
    expect(tree.map(n => `${n.level}:${n.tagName}`)).toEqual([
      '0:fetch',
      '1:entity',
      '2:attribute',
      '2:filter',
      '3:condition',
    ]);

    const [fetch, entity, attribute, filter, condition] = tree;
    expect(entity.parent).toBe(fetch);
    expect(attribute.parent).toBe(entity);
    expect(filter.parent).toBe(entity);
    expect(condition.parent).toBe(filter);

    expect(attributesOf(fetch)).toEqual({ top: '5' });
    expect(attributesOf(entity)).toEqual({ name: 'account' });
    expect(attributesOf(condition)).toEqual({ attribute: 'statecode', operator: 'eq', value: '0' });
    flush();
  }));

  it('reads the text of value nodes', fakeAsync(() => {
    parse([
      '<fetch>',
      '  <entity name="account">',
      '    <filter>',
      '      <condition attribute="industrycode" operator="in">',
      '        <value>1</value>',
      '        <value>2</value>',
      '      </condition>',
      '    </filter>',
      '  </entity>',
      '</fetch>',
    ].join('\n'));

    const values = nodes().filter(n => n.tagName === 'value');
    expect(values.length).toBe(2);
    expect(values.map(v => attributesOf(v)['valuenodeinnertext'])).toEqual(['1', '2']);
    expect(values.every(v => v.parent.tagName === 'condition')).toBeTrue();
    flush();
  }));

  describe('round trip (FetchXML -> tree -> FetchXML)', () => {
    function roundTrip(text: string): string {
      parse(text);
      tick(50);
      return nodeTreeService.xmlRequest$.value;
    }

    // The tree keeps children sorted by node order (order, attribute, link-entity, filter),
    // so these queries are written in that canonical order and must come back unchanged.
    const queries: { [name: string]: string[] } = {
      'attributes, filter and order': [
        '<fetch top="50">',
        '  <entity name="account">',
        '    <order attribute="name" descending="true" />',
        '    <attribute name="name" />',
        '    <attribute name="accountnumber" />',
        '    <filter type="and">',
        '      <condition attribute="statecode" operator="eq" value="0" />',
        '    </filter>',
        '  </entity>',
        '</fetch>',
      ],
      'link-entity': [
        '<fetch>',
        '  <entity name="contact">',
        '    <attribute name="fullname" />',
        '    <link-entity name="account" from="accountid" to="parentcustomerid" link-type="inner" alias="acc">',
        '      <attribute name="name" />',
        '    </link-entity>',
        '  </entity>',
        '</fetch>',
      ],
      'condition with values': [
        '<fetch>',
        '  <entity name="account">',
        '    <filter>',
        '      <condition attribute="industrycode" operator="in">',
        '        <value>1</value>',
        '        <value>2</value>',
        '      </condition>',
        '    </filter>',
        '  </entity>',
        '</fetch>',
      ],
    };

    for (const [name, lines] of Object.entries(queries)) {
      it(`keeps ${name} unchanged`, fakeAsync(() => {
        const text = lines.join('\n');
        expect(roundTrip(text)).toBe(text);
        flush();
      }));
    }

    it('normalizes child order without losing nodes', fakeAsync(() => {
      const rendered = roundTrip([
        '<fetch>',
        '  <entity name="account">',
        '    <filter>',
        '      <condition attribute="statecode" operator="eq" value="0" />',
        '    </filter>',
        '    <attribute name="name" />',
        '    <order attribute="name" />',
        '  </entity>',
        '</fetch>',
      ].join('\n'));

      expect(rendered).toBe([
        '<fetch>',
        '  <entity name="account">',
        '    <order attribute="name" />',
        '    <attribute name="name" />',
        '    <filter>',
        '      <condition attribute="statecode" operator="eq" value="0" />',
        '    </filter>',
        '  </entity>',
        '</fetch>',
      ].join('\n'));
      flush();
    }));
  });
});
