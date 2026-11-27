import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { QueryRenderService } from './query-render.service';
import { NodeTreeService } from './node-tree.service';
import { AttributeData } from '../models/constants/attribute-data';
import { QueryNodeData } from '../models/constants/query-node-data';
import { provideQueryBuilderTesting } from './query-builder-test-providers';

describe('QueryRenderService', () => {
  let renderService: QueryRenderService;
  let nodeTreeService: NodeTreeService;

  // renderXmlRequest() debounces its output by 30 ms.
  function render(): string {
    renderService.renderXmlRequest();
    tick(50);
    return nodeTreeService.xmlRequest$.value;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideQueryBuilderTesting() });
    renderService = TestBed.inject(QueryRenderService);
    nodeTreeService = TestBed.inject(NodeTreeService);
  });

  it('renders the default tree as fetch with a self-closing entity', fakeAsync(() => {
    expect(render()).toBe([
      '<fetch top="10">',
      '  <entity />',
      '</fetch>',
    ].join('\n'));
    flush();
  }));

  it('renders attributes, nesting and self-closing tags, children sorted by node order', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');

    const attribute = nodeTreeService.addNode(QueryNodeData.Attribute.NodeName, entity);
    attribute.setAttribute(AttributeData.Attribute.Name, 'name');

    const order = nodeTreeService.addNode(QueryNodeData.Order.NodeName, entity);
    order.setAttribute(AttributeData.Order.Attribute, 'createdon');
    order.setAttribute(AttributeData.Order.Desc, 'true');

    expect(render()).toBe([
      '<fetch top="10">',
      '  <entity name="account">',
      // Order (node order 2) is placed before Attribute (node order 3) by NodeTreeService.
      '    <order attribute="createdon" descending="true" />',
      '    <attribute name="name" />',
      '  </entity>',
      '</fetch>',
    ].join('\n'));
    flush();
  }));

  it('omits attributes whose value is empty', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'contact');
    entity.setAttribute(AttributeData.Entity.Alias, '');

    expect(render()).toContain('  <entity name="contact" />');
    flush();
  }));

  it('re-renders when an attribute value changes', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    expect(render()).toContain('<entity name="account" />');

    entity.setAttribute(AttributeData.Entity.Name, 'contact');
    tick(50);
    expect(nodeTreeService.xmlRequest$.value).toContain('<entity name="contact" />');
    flush();
  }));

  it('shows text typed into an empty value node without a structural change', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    const filter = nodeTreeService.addNode(QueryNodeData.Filter.NodeName, entity);
    const condition = filter.next;
    condition.setAttribute(AttributeData.Condition.Attribute, 'industrycode');
    condition.setAttribute(AttributeData.Condition.Operator, 'in');
    const valueNode = nodeTreeService.addValueNode(condition);
    expect(render()).toContain('        <value />');

    valueNode.setAttribute(AttributeData.Value.InnerText, '42');
    tick(50);
    expect(nodeTreeService.xmlRequest$.value).toContain('        <value>42</value>');

    valueNode.setAttribute(AttributeData.Value.InnerText, '43');
    tick(50);
    expect(nodeTreeService.xmlRequest$.value).toContain('        <value>43</value>');
    flush();
  }));

  it('renders a burst of changes once, and only when the XML changes', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    render();
    let emissions = 0;
    const sub = nodeTreeService.xmlRequest$.subscribe(() => emissions++);
    emissions = 0;

    entity.setAttribute(AttributeData.Entity.Name, 'a');
    entity.setAttribute(AttributeData.Entity.Name, 'ab');
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    tick(50);
    expect(emissions).toBe(1);

    // A change that does not alter the XML (an empty attribute is omitted) does not re-emit
    entity.setAttribute(AttributeData.Entity.Alias, '');
    tick(50);
    expect(emissions).toBe(1);
    sub.unsubscribe();
    flush();
  }));

  it('escapes &, <, > and " in attribute values and &, <, > in value text', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    const filter = nodeTreeService.addNode(QueryNodeData.Filter.NodeName, entity);
    const condition = filter.next;
    condition.setAttribute(AttributeData.Condition.Attribute, 'name');
    condition.setAttribute(AttributeData.Condition.Operator, 'eq');
    condition.setAttribute(AttributeData.Condition.Value, 'Smith & "Sons" <1>');
    nodeTreeService.addValueNode(condition, 'a & "b" <c>');

    const xml = render();
    expect(xml).toContain('value="Smith &amp; &quot;Sons&quot; &lt;1&gt;"');
    expect(xml).toContain('<value>a &amp; "b" &lt;c&gt;</value>');
    flush();
  }));

  it('renders synchronously from renderXmlRequest()', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');

    expect(renderService.renderXmlRequest()).toBe('<fetch top="10">\n  <entity name="account" />\n</fetch>');
    expect(nodeTreeService.xmlRequest$.value).toBe('<fetch top="10">\n  <entity name="account" />\n</fetch>');
    tick(50);
    flush();
  }));
});
