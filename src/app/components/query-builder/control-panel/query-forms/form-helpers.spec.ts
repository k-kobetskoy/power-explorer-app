import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatTooltip } from '@angular/material/tooltip';
import { Observable, of, throwError } from 'rxjs';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { RelationshipModel, RelationshipType } from 'src/app/models/incoming/link/link-entity-response-model';
import { AttributeData } from '../../models/constants/attribute-data';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { QueryNode } from '../../models/query-node';
import { AttributeEntityService } from '../../services/entity-services/attribute-entity.service';
import { EntityEntityService } from '../../services/entity-services/entity-entity.service';
import { LinkEntityService } from '../../services/entity-services/link-entity.service';
import { NodeTreeService } from '../../services/node-tree.service';
import { provideQueryBuilderTesting } from '../../services/query-builder-test-providers';
import { TreePanelComponent } from '../../tree-panel/tree-panel.component';
import { ControlPanelComponent } from '../control-panel.component';
import { AttributeFormComponent } from './attribute-form/attribute-form.component';
import { FilterConditionFormComponent } from './filter-condition-form/filter-condition-form.component';
import { ScalarValueFormComponent } from './filter-condition-form/scalar-value-form/scalar-value-form.component';
import { SUGGESTION_LIMIT } from './helpers/suggestions';
import { LinkEntityFormComponent } from './link-entity-form/link-entity-form.component';
import { NodeActionsComponent } from './node-actions/node-actions.component';
import { OrderFormComponent } from './order-form/order-form.component';

const column = (logicalName: string, attributeType = 'String'): AttributeModel => ({ logicalName, displayName: '', attributeType });

describe('Query forms: metadata of the parent entity, suggestions and node actions', () => {
  let fixture: ComponentFixture<ControlPanelComponent>;
  let nodeTree: NodeTreeService;
  let entity: QueryNode;
  let columns: { [entity: string]: AttributeModel[] };

  const many = (count: number) => Array.from({ length: count }, (_, index) => column(`column${index}`));
  const relations = (type: RelationshipType, count: number): RelationshipModel[] =>
    Array.from({ length: count }, (_, index) => ({
      SchemaName: `relation${index}`, RelationshipType: type,
      ReferencedEntityName: 'contact', ReferencingEntityName: 'contact',
      ReferencedAttribute: 'contactid', ReferencingAttribute: 'contactid',
      ReferencedEntityNavigationPropertyName: '', ReferencingEntityNavigationPropertyName: '',
    }));

  beforeEach(() => {
    columns = {
      account: [column('name'), column('createdon', 'DateTime')],
      contact: [column('fullname')],
      large: many(SUGGESTION_LIMIT * 3),
    };
    TestBed.configureTestingModule({
      imports: [ControlPanelComponent, TreePanelComponent],
      providers: [...provideQueryBuilderTesting(), provideNoopAnimations()]
    });
    spyOn(TestBed.inject(EntityEntityService), 'getEntities').and.returnValue(of(
      ['account', 'contact', 'large', 'broken', ...many(SUGGESTION_LIMIT * 3).map(item => item.logicalName)]
        .map(logicalName => ({ logicalName, displayName: '', entitySetName: logicalName }))));
    spyOn(TestBed.inject(LinkEntityService), 'getLinkEntities').and.returnValue(of({
      OneToManyRelationships: relations(RelationshipType.OneToMany, SUGGESTION_LIMIT * 2),
      ManyToOneRelationships: relations(RelationshipType.ManyToOne, 3),
    }));
    const attributeService = TestBed.inject(AttributeEntityService);
    const load = (name: string): Observable<AttributeModel[]> =>
      name === 'broken' ? throwError(() => new Error('no metadata')) : of(columns[name] ?? []);
    spyOn(attributeService, 'getAttributes').and.callFake(load);
    spyOn(attributeService, 'getJoinAttributes').and.callFake(load);

    nodeTree = TestBed.inject(NodeTreeService);
    entity = nodeTree.getNodeTree().value.root.next;
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

  const nameEntity = (name: string) => entity.setAttribute(AttributeData.Entity.Name, name);

  /** The list a suggestion stream holds now; the returned function reads later emissions. */
  function watch(stream$: Observable<{ logicalName: string }[]>): () => string[] {
    let result: string[];
    // Unsubscribed by the form when the fixture is destroyed, or garbage collected with it
    stream$.subscribe(list => result = list.map(item => item.logicalName));
    return () => {
      tick(100);
      return result;
    };
  }

  const lists: { form: string, create: () => QueryNode, suggestions: () => Observable<AttributeModel[]> }[] = [
    {
      form: 'attribute',
      create: () => nodeTree.addNode(QueryNodeData.Attribute.NodeName, entity),
      suggestions: () => find(AttributeFormComponent).filteredAttributes$
    },
    {
      form: 'order',
      create: () => nodeTree.addNode(QueryNodeData.Order.NodeName, entity),
      suggestions: () => find(OrderFormComponent).filteredAttributes$
    },
    {
      form: 'condition',
      create: () => nodeTree.addNode(QueryNodeData.Condition.NodeName, entity),
      suggestions: () => find(FilterConditionFormComponent).filteredAttributes$
    },
    {
      form: 'link "To Attribute"',
      create: () => nodeTree.addNode(QueryNodeData.Link.NodeName, entity),
      suggestions: () => find(LinkEntityFormComponent).filteredToAttributes$
    },
  ];

  for (const list of lists) {
    describe(`columns in the ${list.form} form`, () => {
      it('follow the name of the parent entity as it appears and changes', fakeAsync(() => {
        select(list.create());
        const shown = watch(list.suggestions());

        nameEntity('account');
        expect(shown()).toEqual(['name', 'createdon']);
        nameEntity('contact');
        expect(shown()).toEqual(['fullname']);
        finish();
      }));

      it('still follow it after a failed load', fakeAsync(() => {
        spyOn(console, 'error');
        nameEntity('broken');
        select(list.create());
        const shown = watch(list.suggestions());
        expect(shown()).toEqual([]);

        nameEntity('contact');
        expect(shown()).toEqual(['fullname']);
        finish();
      }));

      it('are limited', fakeAsync(() => {
        nameEntity('large');
        select(list.create());

        expect(watch(list.suggestions())().length).toBe(SUGGESTION_LIMIT);
        finish();
      }));
    });
  }

  it('limits the entities of the entity form', fakeAsync(() => {
    select(entity);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('app-entity-form input');
    input.dispatchEvent(new Event('focusin'));
    settle();

    expect(document.querySelectorAll('mat-option').length).toBe(SUGGESTION_LIMIT);
    finish();
  }));

  it('limits every list of the link form, relationships of both kinds together', fakeAsync(() => {
    nameEntity('account');
    const link = nodeTree.addNode(QueryNodeData.Link.NodeName, entity);
    link.setAttribute(AttributeData.Link.Entity, 'large');
    select(link);
    const form = find(LinkEntityFormComponent);

    expect(watch(form.filteredEntities$)().length).toBeLessThanOrEqual(SUGGESTION_LIMIT);
    form.fromAttributeFormControl.setValue('');
    expect(watch(form.filteredFromAttributes$)().length).toBe(SUGGESTION_LIMIT);

    let oneToMany: number;
    let manyToOne: number;
    form.filteredLinkEntities$.subscribe(result => {
      oneToMany = result.OneToManyRelationships.length;
      manyToOne = result.ManyToOneRelationships.length;
    });
    form.linkEntityFormControl.setValue('');
    tick(100);

    expect(manyToOne).toBe(3);
    expect(oneToMany).toBe(SUGGESTION_LIMIT - 3);
    finish();
  }));

  it('shows a date and time input and its operators for a date column', fakeAsync(() => {
    nameEntity('account');
    const condition = nodeTree.addNode(QueryNodeData.Condition.NodeName, entity);
    condition.setAttribute(AttributeData.Condition.Attribute, 'createdon');
    condition.setAttribute(AttributeData.Condition.Value, '2026-01-31T10:30');
    select(condition);

    const form = find(ScalarValueFormComponent);
    const input: HTMLInputElement = fixture.nativeElement.querySelector('app-scalar-value-form input');
    expect(input.type).toBe('datetime-local');
    expect(input.value).toBe('2026-01-31T10:30');
    expect(form.settings.operators.map(operator => operator.value)).toContain('on-or-after');
    finish();
  }));

  it('adds an empty sibling of the same type and says so', fakeAsync(() => {
    const condition = nodeTree.addNode(QueryNodeData.Condition.NodeName, entity);
    condition.setAttribute(AttributeData.Condition.Attribute, 'name');
    select(condition);
    const actions = fixture.debugElement.query(By.directive(NodeActionsComponent));
    const button = actions.query(By.directive(MatTooltip));
    expect(button.injector.get(MatTooltip).message).toBe('Add another condition');

    button.nativeElement.click();
    settle();

    const added = condition.next;
    expect(added.nodeName).toBe(QueryNodeData.Condition.NodeName);
    expect(added.parent).toBe(entity);
    expect(added.findAttribute(AttributeData.Condition.Attribute.EditorName)).toBeUndefined();
    finish();
  }));

  it('offers no delete icon on the root node of the tree', fakeAsync(() => {
    const tree = TestBed.createComponent(TreePanelComponent);
    const shownIcons = () => tree.nativeElement.querySelectorAll('.remove-icon:not(.placeholder-icon)').length;

    nodeTree.selectedNode$ = nodeTree.getNodeTree().value.root;
    tree.detectChanges();
    expect(shownIcons()).toBe(0);

    nodeTree.selectedNode$ = entity;
    tree.detectChanges();
    expect(shownIcons()).toBe(1);
    tree.destroy();
    finish();
  }));
});
