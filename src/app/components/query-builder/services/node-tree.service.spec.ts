import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { NodeTreeService } from './node-tree.service';
import { QueryNodeData } from '../models/constants/query-node-data';
import { AttributeData } from '../models/constants/attribute-data';
import { DefaultAttributesFactoryService } from './attribute-services/attribute-factories/default-attributes-factory.service';
import { provideQueryBuilderTesting } from './query-builder-test-providers';

describe('NodeTreeService', () => {
  let nodeTreeService: NodeTreeService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideQueryBuilderTesting() });
    nodeTreeService = TestBed.inject(NodeTreeService);
  });

  it('removing a node disposes its whole subtree, not only the first chain of children', fakeAsync(() => {
    const entity = nodeTreeService.getNodeTree().value.root.next;
    const filter = nodeTreeService.addNode(QueryNodeData.Filter.NodeName, entity);
    const firstCondition = filter.next;
    const secondCondition = nodeTreeService.addNode(QueryNodeData.Condition.NodeName, filter);
    const valueNode = nodeTreeService.addValueNode(secondCondition, '1');

    const disposed = new Set<string>();
    const watch = { filter, firstCondition, secondCondition, valueNode };
    for (const [name, node] of Object.entries(watch)) {
      node.destroyed$.subscribe({ complete: () => disposed.add(name) });
    }

    nodeTreeService.removeNode(filter);

    expect([...disposed].sort()).toEqual(['filter', 'firstCondition', 'secondCondition', 'valueNode']);
    expect(entity.next).toBeNull();
    flush();
  }));

  it('emits treeChanged$ for structure and attribute value changes', fakeAsync(() => {
    let changes = 0;
    const sub = nodeTreeService.treeChanged$.subscribe(() => changes++);
    const entity = nodeTreeService.getNodeTree().value.root.next;

    const attributeNode = nodeTreeService.addNode(QueryNodeData.Attribute.NodeName, entity);
    expect(changes).toBe(1);

    attributeNode.setAttribute(AttributeData.Attribute.Name, 'name');
    const afterSet = changes;
    expect(afterSet).toBeGreaterThan(1);

    // Setting the same value again is not a change
    attributeNode.setAttribute(AttributeData.Attribute.Name, 'name');
    expect(changes).toBe(afterSet);

    attributeNode.removeAttribute(AttributeData.Attribute.Name.EditorName);
    expect(changes).toBe(afterSet + 1);

    nodeTreeService.removeNode(attributeNode);
    expect(changes).toBe(afterSet + 2);
    sub.unsubscribe();
    flush();
  }));

  it('creates attributes of unknown tags without validators instead of failing', () => {
    const node = nodeTreeService.getNodeTree().value.root;
    const attribute = TestBed.inject(DefaultAttributesFactoryService).createAttribute('custom', node, true, 'x');

    expect(attribute.value$.value).toBe('x');
    let valid: boolean;
    attribute.validationResult$.subscribe(result => valid = result.isValid);
    expect(valid).toBeTrue();
  });
});
