import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { firstValueFrom, of } from 'rxjs';
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
import { EntityFormComponent } from './entity-form/entity-form.component';
import { FilterConditionFormComponent } from './filter-condition-form/filter-condition-form.component';
import { MultiValueFormComponent } from './filter-condition-form/multi-value-form/multi-value-form.component';
import { StringFormComponent } from './filter-condition-form/string-form/string-form.component';
import { FilterFormComponent } from './filter-form/filter-form.component';
import { LinkEntityFormComponent } from './link-entity-form/link-entity-form.component';

describe('Query forms when the selected node changes', () => {
  let fixture: ComponentFixture<ControlPanelComponent>;
  let nodeTree: NodeTreeService;
  let entity: QueryNode;

  const column = (logicalName: string): AttributeModel => ({ logicalName, displayName: '', attributeType: 'String' });
  const columns: { [entity: string]: AttributeModel[] } = {
    account: [column('name'), column('city'), column('primarycontactid')],
    contact: [column('fullname'), column('parentcustomerid')],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ControlPanelComponent],
      providers: [...provideQueryBuilderTesting(), provideNoopAnimations()]
    });
    // Metadata as an environment would answer it; spied before the tree asks for it
    spyOn(TestBed.inject(EntityEntityService), 'getEntities').and.returnValue(of([
      { logicalName: 'account', displayName: 'Account', entitySetName: 'accounts' },
      { logicalName: 'contact', displayName: 'Contact', entitySetName: 'contacts' },
    ]));
    const attributeService = TestBed.inject(AttributeEntityService);
    spyOn(attributeService, 'getAttributes').and.callFake((name: string) => of(columns[name] ?? []));
    spyOn(attributeService, 'getJoinAttributes').and.callFake((name: string) => of(columns[name] ?? []));
    spyOn(TestBed.inject(LinkEntityService), 'getLinkEntities')
      .and.returnValue(of({ OneToManyRelationships: [], ManyToOneRelationships: [] }));

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

  function addCondition(parent: QueryNode, attribute?: string, operator?: string, text?: string): QueryNode {
    const condition = nodeTree.addNode(QueryNodeData.Condition.NodeName, parent);
    if (attribute) {
      condition.setAttribute(AttributeData.Condition.Attribute, attribute);
    }
    if (operator) {
      condition.setAttribute(AttributeData.Condition.Operator, operator);
    }
    if (text) {
      condition.setAttribute(AttributeData.Condition.Value, text);
    }
    return condition;
  }

  function typeInto(selector: string, text: string): HTMLInputElement {
    const input: HTMLInputElement = fixture.nativeElement.querySelector(selector);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  const attributeInput = 'app-filter-condition-form .form-flex > mat-form-field input';

  function confirmAttribute(text: string): void {
    typeInto(attributeInput, text).dispatchEvent(new Event('change'));
    settle();
  }

  describe('condition', () => {
    it('gets the default operator when it is created', fakeAsync(() => {
      const condition = addCondition(entity);

      expect(value(condition, 'operator')).toBe('eq');
      finish();
    }));

    it('selecting a second condition after the first changes neither of them', fakeAsync(() => {
      const first = addCondition(entity, 'name', 'like', 'x%');
      const second = addCondition(entity, 'city', 'ne', 'Oslo');
      const empty = addCondition(entity);
      const withoutOperator = addCondition(entity, 'name');
      withoutOperator.removeAttribute('operator');
      const before = xml();

      for (const node of [first, second, first, empty, second, withoutOperator, first]) {
        select(node);
        expect(xml()).toBe(before);
      }

      expect(find(StringFormComponent).operatorFormControl.value).toBe('like');
      expect(find(StringFormComponent).valueFormControl.value).toBe('x%');
      finish();
    }));

    it('shows an empty condition empty after a filled one', fakeAsync(() => {
      const filled = addCondition(entity, 'name', 'eq', 'x');
      const empty = addCondition(entity);

      select(filled);
      select(empty);

      expect(find(FilterConditionFormComponent).attributeFormControl.value).toBe('');
      expect(find(StringFormComponent)).toBeUndefined();
      finish();
    }));

    it('shows the multi value input for In after the form was reused', fakeAsync(() => {
      const first = addCondition(entity, 'name', 'eq', 'a');
      const second = addCondition(entity, 'city', 'eq', 'b');
      select(first);
      const form = find(StringFormComponent);
      select(second);
      expect(find(StringFormComponent)).toBe(form);

      form.operatorFormControl.setValue('in');
      settle();

      expect(find(MultiValueFormComponent)).toBeDefined();
      expect(value(first, 'value')).toBe('a');
      finish();
    }));

    it('keeps the list of values between operators of the same group', fakeAsync(() => {
      const condition = addCondition(entity, 'name', 'in');
      nodeTree.addValueNode(condition, 'a');
      nodeTree.addValueNode(condition, 'b');
      select(condition);

      find(StringFormComponent).operatorFormControl.setValue('not-in');
      settle();

      expect(xml()).toContain('<value>a</value>');
      expect(xml()).toContain('<value>b</value>');
      finish();
    }));

    it('keeps the value between single value operators', fakeAsync(() => {
      const condition = addCondition(entity, 'name', 'eq', 'a');
      select(condition);

      find(StringFormComponent).operatorFormControl.setValue('ne');

      expect(value(condition, 'value')).toBe('a');
      finish();
    }));

    it('follows eq, in, eq: the inputs match the model and the same text can be typed again', fakeAsync(() => {
      const condition = addCondition(entity, 'name');
      select(condition);
      const form = find(StringFormComponent);
      form.valueFormControl.setValue('abc');

      form.operatorFormControl.setValue('in');
      settle();
      form.operatorFormControl.setValue('eq');
      settle();

      expect(form.valueFormControl.value).toBe('');
      form.valueFormControl.setValue('abc');
      expect(value(condition, 'value')).toBe('abc');
      finish();
    }));

    it('resets operator and value when the user chooses another attribute', fakeAsync(() => {
      const condition = addCondition(entity, 'name', 'like', 'x%');
      select(condition);

      confirmAttribute('city');

      expect(value(condition, 'attribute')).toBe('city');
      expect(value(condition, 'operator')).toBe('eq');
      expect(value(condition, 'value')).toBeUndefined();
      expect(find(StringFormComponent).operatorFormControl.value).toBe('eq');
      expect(find(StringFormComponent).valueFormControl.value).toBe('');
      finish();
    }));

    it('keeps operator and value while a longer name passes through another attribute name', fakeAsync(() => {
      const condition = addCondition(entity, 'city', 'like', 'x%');
      select(condition);

      typeInto(attributeInput, 'name');
      settle();
      expect(value(condition, 'operator')).toBe('like');
      confirmAttribute('namex');
      confirmAttribute('city');

      expect(value(condition, 'operator')).toBe('like');
      expect(value(condition, 'value')).toBe('x%');
      finish();
    }));
  });

  it('shows an empty type for an empty filter after a filter with "or"', fakeAsync(() => {
    const orFilter = nodeTree.addNode(QueryNodeData.Filter.NodeName, entity);
    orFilter.setAttribute(AttributeData.Filter.Type, 'or');
    orFilter.setAttribute(AttributeData.Filter.IsQuickFind, 'true');
    const empty = nodeTree.addNode(QueryNodeData.Filter.NodeName, entity);

    select(orFilter);
    const form = find(FilterFormComponent);
    expect(form.filterTypeFormControl.value).toBe('or');
    select(empty);

    expect(find(FilterFormComponent)).toBe(form);
    expect(form.filterTypeFormControl.value).toBe('');
    expect(form.isQuickFindFieldsFormControl.value).toBeFalse();
    expect(empty.attributes$.value).toEqual([]);
    finish();
  }));

  describe('link-entity', () => {
    const names = (list: AttributeModel[]) => list.map(attribute => attribute.logicalName);

    function latest(stream: 'filteredToAttributes$' | 'filteredFromAttributes$'): string[] {
      let result: string[];
      const subscription = find(LinkEntityFormComponent)[stream].subscribe(list => result = names(list));
      tick(100);
      subscription.unsubscribe();
      return result;
    }

    it('offers the columns of a valid parent as "To Attribute", and of the linked entity as "From"', fakeAsync(() => {
      const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
      select(link);
      expect(latest('filteredToAttributes$')).toEqual(names(columns['account']));

      find(LinkEntityFormComponent).entityNameFormControl.markAsDirty();
      find(LinkEntityFormComponent).entityNameFormControl.setValue('contact');
      settle();

      expect(latest('filteredFromAttributes$')).toEqual(names(columns['contact']));
      finish();
    }));

    it('shows nothing of the previous link and lets the clear action remove the name', fakeAsync(() => {
      const first = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
      first.setAttribute(AttributeData.Link.Entity, 'contact');
      first.setAttribute(AttributeData.Link.Alias, 'c');
      const second = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
      second.setAttribute(AttributeData.Link.Entity, 'account');
      const before = xml();

      select(first);
      select(second);

      const form = find(LinkEntityFormComponent);
      expect(form.aliasFormControl.value).toBeNull();
      expect(xml()).toBe(before);

      // What the clear button does: no user typing, so the control is pristine
      form.entityNameFormControl.patchValue('');
      expect(value(second, 'name')).toBe('');
      finish();
    }));

    it('reads the relationship list from one shared stream', fakeAsync(() => {
      const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
      select(link);
      const stream = find(LinkEntityFormComponent).filteredLinkEntities$;

      let first: unknown;
      let second: unknown;
      firstValueFrom(stream).then(result => first = result);
      const subscription = stream.subscribe();
      firstValueFrom(stream).then(result => second = result);
      tick();

      expect(second).toBe(first);
      subscription.unsubscribe();
      finish();
    }));
  });

  describe('entity', () => {
    function suggestions(): string[] {
      let result: string[];
      const subscription = find(EntityFormComponent).filteredEntities$
        .subscribe(list => result = list.map(item => item.logicalName));
      tick(100);
      subscription.unsubscribe();
      return result;
    }

    it('finds "account" when the user searches "Account"', fakeAsync(() => {
      select(entity);
      const form = find(EntityFormComponent);
      let result: string[];
      const subscription = form.filteredEntities$.subscribe(list => result = list.map(item => item.logicalName));

      form.entityForm.get('name').setValue('Account');
      tick(100);

      expect(result).toEqual(['account']);
      subscription.unsubscribe();
      finish();
    }));

    it('offers suggestions again when the node is selected again', fakeAsync(() => {
      select(entity);
      select(nodeTree.getNodeTree().value.root);
      select(entity);

      expect(find(EntityFormComponent).entityForm.get('name').value).toBe('account');
      expect(suggestions()).toEqual(['account']);
      finish();
    }));
  });
});
