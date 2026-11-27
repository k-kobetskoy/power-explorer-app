import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Observable, ReplaySubject, of } from 'rxjs';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { AttributeData } from '../../models/constants/attribute-data';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { QueryNode } from '../../models/query-node';
import { AttributeEntityService } from '../../services/entity-services/attribute-entity.service';
import { EntityEntityService } from '../../services/entity-services/entity-entity.service';
import { LinkEntityService } from '../../services/entity-services/link-entity.service';
import { NodeTreeService } from '../../services/node-tree.service';
import { provideQueryBuilderTesting } from '../../services/query-builder-test-providers';
import { renderFetchXml } from '../../services/query-render.service';
import { ControlPanelComponent } from '../control-panel.component';
import { FilterConditionFormComponent } from './filter-condition-form/filter-condition-form.component';
import { StringFormComponent } from './filter-condition-form/string-form/string-form.component';
import { LinkEntityFormComponent } from './link-entity-form/link-entity-form.component';

// Defects left open by PER-12
describe('Query forms: condition attribute, join columns and valueless operators', () => {
  let fixture: ComponentFixture<ControlPanelComponent>;
  let nodeTree: NodeTreeService;
  let entity: QueryNode;
  let attributeService: AttributeEntityService;
  // The column list of "account"; a test delays it by not emitting
  let accountColumns$: ReplaySubject<AttributeModel[]>;

  const column = (logicalName: string): AttributeModel => ({ logicalName, displayName: '', attributeType: 'String' });
  const columns = [column('name'), column('city')];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ControlPanelComponent],
      providers: [...provideQueryBuilderTesting(), provideNoopAnimations()]
    });
    spyOn(TestBed.inject(EntityEntityService), 'getEntities').and.returnValue(of(
      ['account', 'contact'].map(logicalName => ({ logicalName, displayName: '', entitySetName: `${logicalName}s` }))));
    spyOn(TestBed.inject(LinkEntityService), 'getLinkEntities')
      .and.returnValue(of({ OneToManyRelationships: [], ManyToOneRelationships: [] }));
    accountColumns$ = new ReplaySubject<AttributeModel[]>(1);
    attributeService = TestBed.inject(AttributeEntityService);
    spyOn(attributeService, 'getAttributes').and.callFake((): Observable<AttributeModel[]> => accountColumns$);
    spyOn(attributeService, 'getJoinAttributes').and.callFake((name: string) => of([column(`${name}id`), ...columns]));

    nodeTree = TestBed.inject(NodeTreeService);
    entity = nodeTree.getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    fixture = TestBed.createComponent(ControlPanelComponent);
  });

  function settle(): void {
    fixture.detectChanges();
    tick(100);
    fixture.detectChanges();
  }

  function select(node: QueryNode): void {
    nodeTree.selectedNode$ = node;
    settle();
  }

  function finish(): void {
    fixture.destroy();
    flush();
    discardPeriodicTasks();
  }

  function find<T>(type: new (...args: any[]) => T): T {
    return fixture.debugElement.query(By.directive(type))?.componentInstance;
  }

  const xml = () => renderFetchXml(nodeTree.getNodeTree().value.root);
  const value = (node: QueryNode, name: string) => node.findAttribute(name)?.value$.value;

  function addCondition(attribute: string, operator: string, text?: string): QueryNode {
    const condition = nodeTree.addNode(QueryNodeData.Condition.NodeName, entity);
    condition.setAttribute(AttributeData.Condition.Attribute, attribute);
    condition.setAttribute(AttributeData.Condition.Operator, operator);
    if (text) {
      condition.setAttribute(AttributeData.Condition.Value, text);
    }
    return condition;
  }

  function confirmAttribute(text: string): void {
    const input: HTMLInputElement = fixture.nativeElement.querySelector('app-filter-condition-form .form-flex > mat-form-field input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    settle();
  }

  describe('condition attribute confirmed while the columns are loading', () => {
    it('resets operator and value of the previous attribute', fakeAsync(() => {
      const condition = addCondition('name', 'like', 'x%');
      select(condition);

      confirmAttribute('city');

      expect(value(condition, 'attribute')).toBe('city');
      expect(value(condition, 'operator')).toBe('eq');
      expect(value(condition, 'value')).toBeUndefined();

      accountColumns$.next(columns);
      settle();

      expect(find(FilterConditionFormComponent).selectedAttribute$.value.logicalName).toBe('city');
      expect(find(StringFormComponent).operatorFormControl.value).toBe('eq');
      expect(find(StringFormComponent).valueFormControl.value).toBe('');
      finish();
    }));

    it('keeps the reset when another node is selected before the columns arrive', fakeAsync(() => {
      const condition = addCondition('name', 'like', 'x%');
      select(condition);

      confirmAttribute('city');
      select(entity);
      accountColumns$.next(columns);
      select(condition);

      expect(value(condition, 'operator')).toBe('eq');
      expect(value(condition, 'value')).toBeUndefined();
      finish();
    }));

    it('resets nothing when it is the attribute the condition already had', fakeAsync(() => {
      const condition = addCondition('name', 'like', 'x%');
      select(condition);

      confirmAttribute('name');
      accountColumns$.next(columns);
      settle();

      expect(value(condition, 'operator')).toBe('like');
      expect(value(condition, 'value')).toBe('x%');
      finish();
    }));
  });

  it('offers the primary keys in "From Attribute" and "To Attribute" of a link', fakeAsync(() => {
    accountColumns$.next(columns);
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    link.setAttribute(AttributeData.Link.Entity, 'contact');
    select(link);
    const form = find(LinkEntityFormComponent);

    let from: string[];
    let to: string[];
    const subscriptions = [
      form.filteredFromAttributes$.subscribe(list => from = list.map(item => item.logicalName)),
      form.filteredToAttributes$.subscribe(list => to = list.map(item => item.logicalName)),
    ];
    tick(100);

    expect(from).toContain('contactid');
    expect(to).toContain('accountid');
    subscriptions.forEach(subscription => subscription.unsubscribe());
    finish();
  }));

  describe('operator that takes no value', () => {
    beforeEach(() => accountColumns$.next(columns));

    for (const operator of ['null', 'not-null']) {
      it(`removes the value from the node and the XML: eq, ${operator}`, fakeAsync(() => {
        const condition = addCondition('name', 'eq', 'abc');
        select(condition);

        find(StringFormComponent).operatorFormControl.setValue(operator);
        settle();

        expect(condition.findAttribute('value')).toBeUndefined();
        expect(xml()).toContain(`operator="${operator}"`);
        expect(xml()).not.toContain('abc');
        expect(find(StringFormComponent).valueFormControl.value).toBeFalsy();
        finish();
      }));
    }

    it('removes the value nodes of a multi value operator', fakeAsync(() => {
      const condition = addCondition('name', 'in');
      nodeTree.addValueNode(condition, 'abc');
      select(condition);

      find(StringFormComponent).operatorFormControl.setValue('null');
      settle();

      expect(condition.findAttribute('value')).toBeUndefined();
      expect(xml()).not.toContain('<value');
      finish();
    }));

    it('leaves an empty value input to type into after switching back', fakeAsync(() => {
      const condition = addCondition('name', 'eq', 'abc');
      select(condition);
      const form = find(StringFormComponent);

      form.operatorFormControl.setValue('null');
      settle();
      form.operatorFormControl.setValue('eq');
      settle();

      expect(form.valueFormControl.value).toBe('');
      form.valueFormControl.setValue('abc');
      expect(value(condition, 'value')).toBe('abc');
      finish();
    }));
  });
});
