import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AttributeData } from '../../models/constants/attribute-data';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { QueryNode } from '../../models/query-node';
import { NodeTreeService } from '../../services/node-tree.service';
import { provideQueryBuilderTesting } from '../../services/query-builder-test-providers';
import { AttributeFormComponent } from './attribute-form/attribute-form.component';
import { ValueFormComponent } from './value-form/value-form.component';

describe('Query forms and the attributes of their node', () => {
  let nodeTree: NodeTreeService;
  let entity: QueryNode;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [NoopAnimationsModule], providers: provideQueryBuilderTesting() });
    nodeTree = TestBed.inject(NodeTreeService);
    entity = nodeTree.getNodeTree().value.root.next;
  });

  it('value form keeps the input when the first keystroke creates the attribute', fakeAsync(() => {
    const condition = nodeTree.addNode(QueryNodeData.Condition.NodeName, entity);
    const valueNode = nodeTree.addValueNode(condition);
    const form = TestBed.createComponent(ValueFormComponent).componentInstance;
    form.selectedNode = valueNode;
    form.ngOnInit();

    form.valueFormControl.setValue('a');

    expect(form.valueFormControl.value).toBe('a');
    expect(valueNode.findAttribute(AttributeData.Value.InnerText.EditorName).value$.value).toBe('a');
    form.ngOnDestroy();
    flush();
  }));

  it('attribute form follows attributes added later and keeps typed text', fakeAsync(() => {
    const node = nodeTree.addNode(QueryNodeData.Attribute.NodeName, entity);
    const form = TestBed.createComponent(AttributeFormComponent).componentInstance;
    form.selectedNode = node;
    form.ngOnInit();
    const name = form.attributeForm.get('name');
    const alias = form.attributeForm.get('alias');

    alias.setValue('n');
    tick(10);
    name.setValue('na');
    tick(60);
    expect(alias.value).toBe('n');
    expect(name.value).toBe('na');

    node.setAttribute(AttributeData.Attribute.Name, 'name');
    expect(name.value).toBe('name');
    node.removeAttribute(AttributeData.Attribute.Alias.EditorName);
    node.setAttribute(AttributeData.Attribute.Alias, 'other');
    expect(alias.value).toBe('other');

    form.ngOnDestroy();
    flush();
  }));
});
