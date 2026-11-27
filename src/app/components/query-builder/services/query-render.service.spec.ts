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
});
