import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { ensureSyntaxTree } from '@codemirror/language';
import { XmlParseResult, XmlParseService } from './xml-parse.service';
import { NodeTreeService } from '../node-tree.service';
import { QueryRenderService } from '../query-render.service';
import { QueryNode } from '../../models/query-node';
import { AttributeData } from '../../models/constants/attribute-data';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { ValidationResult } from '../validation.service';
import { XmlExecutorService } from '../xml-executor.service';
import { NotificationService } from 'src/app/services/notification.service';
import { QueryTreeButtonBlockComponent } from '../../query-tree-button-block/query-tree-button-block.component';
import { provideQueryBuilderTesting } from '../query-builder-test-providers';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';

describe('XmlParseService: atomic Parse, escaping and validation', () => {
  let parseService: XmlParseService;
  let nodeTreeService: NodeTreeService;
  let renderService: QueryRenderService;
  let notifications: jasmine.SpyObj<NotificationService>;
  let view: EditorView;

  function parse(text: string): XmlParseResult {
    view?.destroy();
    view = new EditorView({ state: EditorState.create({ doc: text, extensions: [xml()] }) });
    return parseService.parseXmlManually(view);
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

  const validQuery = [
    '<fetch top="5">',
    '  <entity name="account">',
    '    <attribute name="name" />',
    '  </entity>',
    '</fetch>',
  ].join('\n');

  beforeEach(() => {
    notifications = jasmine.createSpyObj<NotificationService>('NotificationService', ['showError', 'showSuccess', 'showInfo']);
    TestBed.configureTestingModule({
      providers: [...provideQueryBuilderTesting(), { provide: NotificationService, useValue: notifications }]
    });
    parseService = TestBed.inject(XmlParseService);
    nodeTreeService = TestBed.inject(NodeTreeService);
    renderService = TestBed.inject(QueryRenderService);
  });

  afterEach(() => view?.destroy());

  describe('rejected text', () => {
    const rejected: { [name: string]: string } = {
      'a missing closing tag': '<fetch>\n  <entity name="contact">\n</fetch>',
      'a mismatched closing tag': '<fetch>\n  <entity name="contact" />\n</fetc>',
      'a broken tag': '<fetch>\n  <entity name="contact" / \n</fetch>',
      'an unquoted attribute value': '<fetch>\n  <entity name=contact />\n</fetch>',
      'a misspelled tag': '<fetch>\n  <entty name="contact" />\n</fetch>',
      'a tag that is not supported': '<fetch>\n  <entity name="contact">\n    <all-attributes />\n  </entity>\n</fetch>',
      'two root elements': '<fetch>\n  <entity name="contact" />\n</fetch>\n<fetch />',
      'empty text': '   ',
    };

    for (const [name, text] of Object.entries(rejected)) {
      it(`with ${name} changes nothing and shows the reason`, fakeAsync(() => {
        parse(validQuery);
        tick(50);
        const treeBefore = nodeTreeService.getNodeTree().value;
        const nodesBefore = nodes();
        let selected: QueryNode;
        const selectedSub = nodeTreeService.selectedNode$.subscribe(node => selected = node);
        const selectedBefore = selected;
        const xmlBefore = nodeTreeService.xmlRequest$.value;
        let treeEmissions = 0;
        let xmlEmissions = 0;
        const treeSub = nodeTreeService.getNodeTree().subscribe(() => treeEmissions++);
        const xmlSub = nodeTreeService.xmlRequest$.subscribe(() => xmlEmissions++);
        treeEmissions = 0;
        xmlEmissions = 0;
        notifications.showError.calls.reset();

        const result = parse(text);
        tick(50);

        expect(result.success).toBeFalse();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(notifications.showError).toHaveBeenCalledTimes(1);
        expect(notifications.showError.calls.mostRecent().args[0]).toContain(result.errors[0]);
        expect(nodeTreeService.getNodeTree().value).toBe(treeBefore);
        expect(nodes()).toEqual(nodesBefore);
        expect(selected).toBe(selectedBefore);
        expect(nodeTreeService.xmlRequest$.value).toBe(xmlBefore);
        expect(treeEmissions).toBe(0);
        expect(xmlEmissions).toBe(0);
        expect(view.state.doc.toString()).toBe(text);

        selectedSub.unsubscribe();
        treeSub.unsubscribe();
        xmlSub.unsubscribe();
        flush();
      }));
    }

    it('is reported with the tag and its line', fakeAsync(() => {
      const result = parse('<fetch>\n  <entity name="contact">\n    <all-attributes />\n  </entity>\n</fetch>');
      expect(result.errors).toEqual(['Line 3: unknown tag <all-attributes>.']);
      expect(notifications.showError).toHaveBeenCalledWith('Parse cancelled. Line 3: unknown tag <all-attributes>.');
      flush();
    }));
  });

  describe('accepted text', () => {
    it('replaces the tree in one step, selects the new root and releases every old node', fakeAsync(() => {
      parse([
        '<fetch>',
        '  <entity name="account">',
        '    <attribute name="name" />',
        '    <attribute name="accountnumber" />',
        '    <filter>',
        '      <condition attribute="statecode" operator="eq" value="0" />',
        '      <condition attribute="name" operator="not-null" />',
        '    </filter>',
        '  </entity>',
        '</fetch>',
      ].join('\n'));
      tick(50);
      const oldNodes = nodes();
      const disposed = oldNodes.map(() => false);
      oldNodes.forEach((node, i) => node.destroyed$.subscribe({ complete: () => disposed[i] = true }));

      let selected: QueryNode;
      const selectedSub = nodeTreeService.selectedNode$.subscribe(node => selected = node);
      let treeEmissions = 0;
      let xmlEmissions = 0;
      const treeSub = nodeTreeService.getNodeTree().subscribe(() => treeEmissions++);
      const xmlSub = nodeTreeService.xmlRequest$.subscribe(() => xmlEmissions++);
      treeEmissions = 0;
      xmlEmissions = 0;

      const result = parse(validQuery);
      tick(50);

      expect(result.success).toBeTrue();
      expect(treeEmissions).toBe(1);
      expect(xmlEmissions).toBe(1);
      expect(selected).toBe(nodeTreeService.getNodeTree().value.root);
      expect(disposed.every(d => d)).toBeTrue();
      expect(nodeTreeService.xmlRequest$.value).toBe(validQuery);

      selectedSub.unsubscribe();
      treeSub.unsubscribe();
      xmlSub.unsubscribe();
      flush();
    }));

    it('replaces the editor text with the normalized XML even when the query is the same', fakeAsync(() => {
      parse(validQuery);
      tick(50);
      let xmlEmissions = 0;
      const xmlSub = nodeTreeService.xmlRequest$.subscribe(() => xmlEmissions++);
      xmlEmissions = 0;

      parse('<fetch top="5"><entity name="account"><attribute name="name"/></entity></fetch>');
      tick(50);

      expect(xmlEmissions).toBe(1);
      expect(nodeTreeService.xmlRequest$.value).toBe(validQuery);
      xmlSub.unsubscribe();
      flush();
    }));

    it('keeps an unknown attribute of a known tag as it is', fakeAsync(() => {
      const result = parse('<fetch>\n  <entity name="account" custom="x" />\n</fetch>');
      expect(result.success).toBeTrue();
      expect(attributesOf(nodes()[1])).toEqual({ name: 'account', custom: 'x' });
      flush();
    }));
  });

  describe('XML escaping', () => {
    it('the XML grammar gives entity references in text as separate nodes next to Text', () => {
      const state = EditorState.create({ doc: '<value>a &amp; b</value>', extensions: [xml()] });
      const names: string[] = [];
      ensureSyntaxTree(state, state.doc.length).cursor().iterate(node => { names.push(node.name); });
      expect(names).toContain('EntityReference');
      expect(names.filter(name => name === 'Text').length).toBe(2);
    });

    it('turns value text with entity and character references into one text attribute', fakeAsync(() => {
      parse([
        '<fetch>',
        '  <entity name="account">',
        '    <filter>',
        '      <condition attribute="name" operator="in">',
        '        <value>a &amp; b &#60; c &#x3E; d</value>',
        '      </condition>',
        '    </filter>',
        '  </entity>',
        '</fetch>',
      ].join('\n'));
      const value = nodes().find(n => n.tagName === 'value');
      expect(value.attributes$.value.length).toBe(1);
      expect(attributesOf(value)['valuenodeinnertext']).toBe('a & b < c > d');
      flush();
    }));

    it('reads attributes in single quotes and decodes the predefined entities', fakeAsync(() => {
      parse([
        `<fetch>`,
        `  <entity name='account'>`,
        `    <filter>`,
        `      <condition attribute='name' operator='eq' value='O&apos;Brien &quot;x&quot; &lt;&gt;' />`,
        `    </filter>`,
        `  </entity>`,
        `</fetch>`,
      ].join('\n'));
      const condition = nodes().find(n => n.tagName === 'condition');
      expect(attributesOf(nodes()[1])).toEqual({ name: 'account' });
      expect(attributesOf(condition)).toEqual({ attribute: 'name', operator: 'eq', value: 'O\'Brien "x" <>' });
      flush();
    }));

    for (const value of ['Smith & Sons', 'a "b" c', '1 < 2', 'x > y', 'it\'s']) {
      it(`keeps «${value}» through tree -> XML -> Parse -> tree, and the XML is well-formed`, fakeAsync(() => {
        const entity = nodeTreeService.getNodeTree().value.root.next;
        entity.setAttribute(AttributeData.Entity.Name, 'account');
        const filter = nodeTreeService.addNode(QueryNodeData.Filter.NodeName, entity);
        const condition = filter.next;
        condition.setAttribute(AttributeData.Condition.Attribute, 'name');
        condition.setAttribute(AttributeData.Condition.Operator, 'like');
        condition.setAttribute(AttributeData.Condition.Value, value);
        nodeTreeService.addValueNode(condition, value);

        const rendered = renderService.renderXmlRequest();

        const dom = new DOMParser().parseFromString(rendered, 'application/xml');
        expect(dom.getElementsByTagName('parsererror').length).toBe(0);
        expect(dom.getElementsByTagName('condition')[0].getAttribute('value')).toBe(value);
        expect(dom.getElementsByTagName('value')[0].textContent).toBe(value);

        expect(parse(rendered).success).toBeTrue();
        expect(attributesOf(nodes().find(n => n.tagName === 'condition'))['value']).toBe(value);
        expect(attributesOf(nodes().find(n => n.tagName === 'value'))['valuenodeinnertext']).toBe(value);
        expect(nodeTreeService.xmlRequest$.value).toBe(rendered);
        tick(50);
        flush();
      }));
    }
  });
});

describe('Execute availability after Parse', () => {
  const envUrl = 'https://test.example.invalid';
  let parseService: XmlParseService;
  let nodeTreeService: NodeTreeService;
  let renderService: QueryRenderService;
  let http: HttpTestingController;
  let view: EditorView;
  let latest: ValidationResult;

  function parse(text: string): XmlParseResult {
    view?.destroy();
    view = new EditorView({ state: EditorState.create({ doc: text, extensions: [xml()] }) });
    return parseService.parseXmlManually(view);
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // An environment is needed: the entity name is validated against the entity list of the environment
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject({ url: envUrl, apiUrl: envUrl, friendlyName: 'Test', urlName: 'test' }) },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
        { provide: NotificationService, useValue: jasmine.createSpyObj<NotificationService>('NotificationService', ['showError']) },
      ]
    });
    parseService = TestBed.inject(XmlParseService);
    nodeTreeService = TestBed.inject(NodeTreeService);
    renderService = TestBed.inject(QueryRenderService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => view?.destroy());

  function createButtonBlock(): QueryTreeButtonBlockComponent {
    const component = new QueryTreeButtonBlockComponent(
      nodeTreeService, TestBed.inject(XmlExecutorService), renderService);
    component.ngOnInit();
    component.buttonDisabled$.subscribe(result => latest = result);
    return component;
  }

  function answerEntityList(): void {
    http.expectOne(request => request.url.startsWith(`${envUrl}/api/data/v9.2/EntityDefinitions?`)).flush({
      value: [
        { LogicalName: 'account', DisplayName: {}, EntitySetName: 'accounts' },
        { LogicalName: 'contact', DisplayName: {}, EntitySetName: 'contacts' },
      ]
    });
  }

  const invalidQuery = '<fetch>\n  <entity />\n</fetch>';
  const validQuery = '<fetch>\n  <entity name="account" />\n</fetch>';
  const unknownEntityQuery = '<fetch>\n  <entity name="nosuchentity" />\n</fetch>';

  it('follows validation in both directions, with no timers involved', fakeAsync(() => {
    const component = createButtonBlock();

    parse(invalidQuery);
    expect(latest.isValid).toBeFalse();

    parse(validQuery);
    answerEntityList();
    expect(latest.isValid).toBeTrue();

    parse(unknownEntityQuery);
    expect(latest.isValid).toBeFalse();

    parse(validQuery);
    expect(latest.isValid).toBeTrue();

    parse(invalidQuery);
    expect(latest.isValid).toBeFalse();

    // Fixing the parsed query in the tree enables Execute again, and breaking it disables it
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'contact');
    expect(latest.isValid).toBeTrue();
    entity.setAttribute(AttributeData.Entity.Name, 'nosuchentity');
    expect(latest.isValid).toBeFalse();

    component.ngOnDestroy();
    http.verify();
    tick(50);
    flush();
  }));

  it('is disabled while the new tree is still being validated against metadata', fakeAsync(() => {
    const component = createButtonBlock();
    parse(validQuery);
    answerEntityList();
    expect(latest.isValid).toBeTrue();

    // The attribute list of the entity is not loaded yet, so the new tree has no verdict
    parse('<fetch>\n  <entity name="account">\n    <attribute name="nosuchattribute" />\n  </entity>\n</fetch>');
    expect(latest.isValid).toBeFalse();

    http.expectOne(request => request.url.includes('/Attributes?')).flush({ value: [] });
    expect(latest.isValid).toBeFalse();

    component.ngOnDestroy();
    tick(50);
    flush();
  }));

  it('executes the XML of the tree as it is at the moment of the click', fakeAsync(() => {
    const component = createButtonBlock();
    parse(validQuery);
    answerEntityList();
    let executed: string;
    component.executeXmlRequest.subscribe(event => executed = event.xml);

    nodeTreeService.getNodeTree().value.root.next.setAttribute(AttributeData.Entity.Name, 'contact');
    component.execute();

    expect(executed).toBe('<fetch>\n  <entity name="contact" />\n</fetch>');
    component.ngOnDestroy();
    tick(50);
    flush();
  }));
});
