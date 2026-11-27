import { Component, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy, Input, ViewEncapsulation } from '@angular/core';
import { BaseFormComponent } from '../base-form.component';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject, combineLatest, shareReplay, BehaviorSubject } from 'rxjs';
import { map, startWith, takeUntil, filter, take } from 'rxjs/operators';
import { EntityModel } from 'src/app/models/incoming/environment/entity-model';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { EntityEntityService } from '../../../services/entity-services/entity-entity.service';
import { AttributeEntityService } from '../../../services/entity-services/attribute-entity.service';
import { LinkTypeOptions } from '../../../models/constants/ui/link-type-options';
import { QueryNode } from '../../../models/query-node';
import { AttributeData, IAttributeData } from '../../../models/constants/attribute-data';
import { LinkEntityService } from '../../../services/entity-services/link-entity.service';
import { LinkEntityResponseModel, RelationshipModel, RelationshipType } from 'src/app/models/incoming/link/link-entity-response-model';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatOptionModule } from '@angular/material/core';
import { QuickActionsComponent } from '../quick-actions/quick-actions.component';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatButtonModule } from '@angular/material/button';
import { NodeTreeService } from 'src/app/components/query-builder/services/node-tree.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NodeActionsComponent } from '../node-actions/node-actions.component';
import { bindControlToAttribute } from '../helpers/attribute-binding';
import { MetadataSource, entityMetadata$, parentEntityMetadata$ } from '../helpers/entity-metadata';
import { SUGGESTION_LIMIT, suggestions$ } from '../helpers/suggestions';
// Interface for relation object to improve type safety
interface RelationObject extends RelationshipModel { }

@Component({  
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatInputModule,
    MatAutocompleteModule,
    MatSelectModule,
    MatOptionModule,
    MatIconModule,
    MatTooltipModule,
    QuickActionsComponent,
    MatButtonModule,
    FormsModule,
    MatProgressSpinnerModule,
    NodeActionsComponent
  ],
  selector: 'app-link-entity-form',
  templateUrl: './link-entity-form.component.html',
  styleUrls: ['./link-entity-form.component.css'],    
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class LinkEntityFormComponent extends BaseFormComponent implements OnDestroy, OnChanges {
  @Input() selectedNode: QueryNode;

  private destroy$ = new Subject<void>();

  readonly linkTypes = LinkTypeOptions;

  entityNameFormControl = new FormControl<string | null>('');
  linkEntityFormControl = new FormControl<string | RelationshipModel | null>('');
  fromAttributeFormControl = new FormControl<string | null>('');
  toAttributeFormControl = new FormControl<string | null>('');
  linkTypeFormControl = new FormControl<string | null>('');
  aliasFormControl = new FormControl<string | null>('');
  intersectFormControl = new FormControl<boolean>(false);
  visibleFormControl = new FormControl<boolean>(false);
  fetchAllEntitiesFormControl = new FormControl<boolean>(false);

  // Observables for autocomplete
  filteredEntities$: Observable<EntityModel[]>; // New entity to link to 
  filteredFromAttributes$: Observable<AttributeModel[]>; // From attribute of the new entity
  filteredToAttributes$: Observable<AttributeModel[]>; // To attribute of the parent entity
  filteredLinkEntities$: Observable<LinkEntityResponseModel>;

  entities$: Observable<EntityModel[]>;
  fromAttributes$: Observable<AttributeModel[]>;
  toAttributes$: Observable<AttributeModel[]>;

  linkEntities$: Observable<LinkEntityResponseModel>;
  fetchAllEntities$: Observable<boolean>;

  isLoadingToAttributes$ : BehaviorSubject<boolean>;
  isLoadingFromAttributes$ : BehaviorSubject<boolean>;
  isLoadingLinkEntities$ : BehaviorSubject<boolean>;
  isLoadingEntities$ : BehaviorSubject<boolean>;

  constructor(
    private entityService: EntityEntityService,
    private linkEntityService: LinkEntityService,
    private attributeService: AttributeEntityService,
    private nodeTreeService: NodeTreeService) { super();
      this.isLoadingLinkEntities$ = this.linkEntityService.getLinkEntitiesIsLoading$;
      this.isLoadingEntities$ = this.entityService.getEntitiesIsLoading$;
      this.isLoadingFromAttributes$ = this.attributeService.getFromAttributesIsLoading$;
      this.isLoadingToAttributes$ = this.attributeService.getToAttributesIsLoading$;
    }
  

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selectedNode'] && this.selectedNode) {
      this.destroy$.next();
      this.initializeForm();
    }
  }

  private initializeForm() {
    this.setupInitialValues();

    this.setupLinkEntitiesObservable();

    // After setupLinkEntitiesObservable, which may switch the checkbox on
    this.fetchAllEntities$ = this.fetchAllEntitiesFormControl.valueChanges.pipe(
      startWith(this.fetchAllEntitiesFormControl.value),
      takeUntil(this.destroy$)
    );

    this.subscribeOnLinkEntityFormControlValidityState();
    this.subscribeOnFetchAllEntitiesFormControlChanges();

    this.setupEntityAutocomplete();
    this.setupLinkEntityAutocomplete();
    this.setupFromAttributeAutocomplete();
    this.setupToAttributeAutocomplete();

    this.setupBindings();
  }

  removeNode() {
    this.nodeTreeService.removeNode(this.selectedNode);
  }

  subscribeOnFetchAllEntitiesFormControlChanges() {
    this.fetchAllEntitiesFormControl.valueChanges.pipe(
      takeUntil(this.destroy$)
    ).subscribe(fetchAll => {
      if (this.fetchAllEntitiesFormControl.dirty) {
        this.updateAttribute(AttributeData.Link.FetchAllEntities, this.selectedNode, fetchAll.toString());
        
        this.clearAllAttributes();
      }
    });
  }
  clearAllAttributes() {
    // Clear all form values
    this.entityNameFormControl.setValue(null, { emitEvent: true });
    this.linkEntityFormControl.setValue(null, { emitEvent: true });
    this.fromAttributeFormControl.setValue(null, { emitEvent: true });
    this.toAttributeFormControl.setValue(null, { emitEvent: true });
    this.linkTypeFormControl.setValue(null, { emitEvent: true });
    this.aliasFormControl.setValue(null, { emitEvent: true });
    
    // Mark controls as dirty to ensure changes get propagated
    this.entityNameFormControl.markAsDirty();
    this.linkEntityFormControl.markAsDirty();
    this.fromAttributeFormControl.markAsDirty();
    this.toAttributeFormControl.markAsDirty();
    this.linkTypeFormControl.markAsDirty();
    this.aliasFormControl.markAsDirty();
  }

  subscribeOnLinkEntityFormControlValidityState() {
    this.linkEntityFormControl.valueChanges.pipe(
      filter(() => this.linkEntityFormControl.dirty),
      takeUntil(this.destroy$)
    ).subscribe(value => {
      if (value && typeof value === 'object') {
        this.handleFullRelationObject(value);
      }
    });
  }

  setupLinkEntitiesObservable() {
    const parentEntity = this.selectedNode.getParentEntity();

    // The mode is chosen once, when the form gets its node; the list keeps following the parent
    let isParentValid = false;
    parentEntity?.validationResult$.pipe(take(1)).subscribe(result => {
      isParentValid = result.isValid;
    });

    if (!isParentValid && !this.fetchAllEntitiesFormControl.value) {
      this.fetchAllEntitiesFormControl.setValue(true, { emitEvent: true });
    }

    this.linkEntities$ = parentEntityMetadata$<LinkEntityResponseModel>(parentEntity, {
      load: entityName => this.linkEntityService.getLinkEntities(entityName, true),
      empty: { OneToManyRelationships: [], ManyToOneRelationships: [] },
      loading$: this.isLoadingLinkEntities$
    }).pipe(takeUntil(this.destroy$));
  }

  private setupLinkEntityAutocomplete() {
    this.filteredLinkEntities$ = combineLatest([
      this.linkEntityFormControl.valueChanges.pipe(startWith(this.linkEntityFormControl.value || '')),
      this.linkEntities$,
    ]).pipe(
      map(([searchTerm, linkEntities]) => this.filterRelationships(searchTerm, linkEntities)),
      takeUntil(this.destroy$),
      // The template reads this list in several places
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  private setupBindings() {
    bindControlToAttribute(this.entityNameFormControl, this.selectedNode, AttributeData.Link.Entity, this.destroy$, {
      canWrite: () => this.entityNameFormControl.dirty || this.hasEntityName()
    });

    // Written one way only: the control holds a relationship, the node only the name of its entity
    this.linkEntityFormControl.valueChanges.pipe(
      filter(() => this.linkEntityFormControl.dirty || this.hasEntityName()),
      takeUntil(this.destroy$)
    ).subscribe(value => {
      this.updateAttribute(AttributeData.Link.Entity, this.selectedNode, this.displayEntityName(value));
    });

    bindControlToAttribute(this.fromAttributeFormControl, this.selectedNode, AttributeData.Link.From, this.destroy$);
    bindControlToAttribute(this.toAttributeFormControl, this.selectedNode, AttributeData.Link.To, this.destroy$);
    bindControlToAttribute(this.linkTypeFormControl, this.selectedNode, AttributeData.Link.Type, this.destroy$);
    bindControlToAttribute(this.aliasFormControl, this.selectedNode, AttributeData.Link.Alias, this.destroy$);

    this.bindCheckbox(this.intersectFormControl, AttributeData.Link.Intersect);
    this.bindCheckbox(this.visibleFormControl, AttributeData.Link.Visible);
  }

  private bindCheckbox(control: FormControl<boolean>, attributeData: IAttributeData) {
    bindControlToAttribute<boolean>(control, this.selectedNode, attributeData, this.destroy$, {
      fromModel: value => value === 'true',
      toModel: value => value.toString(),
      canWrite: () => control.dirty
    });
  }

  private hasEntityName(): boolean {
    return !!this.getAttribute(AttributeData.Link.Entity, this.selectedNode);
  }

  private setupInitialValues() {
    const fetchAllEntities = this.getAttribute(AttributeData.Link.FetchAllEntities, this.selectedNode);
    this.fetchAllEntitiesFormControl.reset(fetchAllEntities?.value$.value === 'true', { emitEvent: false });

    // reset, not setValue: the controls must not stay dirty after the previous node
    this.entityNameFormControl.reset(null, { emitEvent: false });
    this.linkEntityFormControl.reset(null, { emitEvent: false });
    this.fromAttributeFormControl.reset(null, { emitEvent: false });
    this.toAttributeFormControl.reset(null, { emitEvent: false });
    this.linkTypeFormControl.reset(null, { emitEvent: false });
    this.aliasFormControl.reset(null, { emitEvent: false });
    this.intersectFormControl.reset(false, { emitEvent: false });
    this.visibleFormControl.reset(false, { emitEvent: false });

    const entityName = this.getAttribute(AttributeData.Link.Entity, this.selectedNode);
    if (entityName && entityName.value$.value) {
      this.entityNameFormControl.setValue(entityName.value$.value, { emitEvent: false });
      this.linkEntityFormControl.setValue(entityName.value$.value, { emitEvent: false });
    }

    const fromAttribute = this.getAttribute(AttributeData.Link.From, this.selectedNode);
    if (fromAttribute && fromAttribute.value$.value) {
      this.fromAttributeFormControl.setValue(fromAttribute.value$.value, { emitEvent: false });
    }

    const toAttribute = this.getAttribute(AttributeData.Link.To, this.selectedNode);
    if (toAttribute && toAttribute.value$.value) {
      this.toAttributeFormControl.setValue(toAttribute.value$.value, { emitEvent: false });
    }

    const linkType = this.getAttribute(AttributeData.Link.Type, this.selectedNode);
    if (linkType && linkType.value$.value) {
      this.linkTypeFormControl.setValue(linkType.value$.value, { emitEvent: false });
    }

    const alias = this.getAttribute(AttributeData.Link.Alias, this.selectedNode);
    if (alias && alias.value$.value) {
      this.aliasFormControl.setValue(alias.value$.value, { emitEvent: false });
    }

    const intersect = this.getAttribute(AttributeData.Link.Intersect, this.selectedNode);
    if (intersect && intersect.value$.value) {
      this.intersectFormControl.setValue(intersect.value$.value === 'true', { emitEvent: false });
    }

    const visible = this.getAttribute(AttributeData.Link.Visible, this.selectedNode);
    if (visible && visible.value$.value) {
      this.visibleFormControl.setValue(visible.value$.value === 'true', { emitEvent: false });
    }
  }

  private setupEntityAutocomplete() {
    this.filteredEntities$ = suggestions$(this.entityNameFormControl, this.entityService.getEntities(true));
  }

  private setupFromAttributeAutocomplete() {
    const attributes$ = entityMetadata$(this.selectedNode, this.joinAttributes());

    this.filteredFromAttributes$ = suggestions$(this.fromAttributeFormControl, attributes$).pipe(takeUntil(this.destroy$));
  }

  private setupToAttributeAutocomplete() {
    const attributes$ = parentEntityMetadata$(this.selectedNode.getParentEntity(), this.joinAttributes());

    this.filteredToAttributes$ = suggestions$(this.toAttributeFormControl, attributes$).pipe(takeUntil(this.destroy$));
  }

  // Columns usable in `from` and `to`, primary keys included
  private joinAttributes(): MetadataSource<AttributeModel[]> {
    return {
      load: entityName => this.attributeService.getJoinAttributes(entityName),
      empty: []
    };
  }

  // The matching relationships, at most SUGGESTION_LIMIT for both groups together
  private filterRelationships(search: string | RelationshipModel, linkEntities: LinkEntityResponseModel): LinkEntityResponseModel {
    // A chosen relationship is not a search text
    const text = typeof search === 'string' ? search.toLowerCase() : '';

    const oneToMany = linkEntities.OneToManyRelationships.filter(relation =>
      relation.ReferencingEntityName.toLowerCase().includes(text) ||
      relation.SchemaName.toLowerCase().includes(text));

    const manyToOne = linkEntities.ManyToOneRelationships.filter(relation =>
      relation.ReferencedEntityName.toLowerCase().includes(text) ||
      relation.SchemaName.toLowerCase().includes(text));

    // Each group gets half of the limit, plus what the other one leaves free
    const oneToManyCount = Math.min(oneToMany.length, Math.max(SUGGESTION_LIMIT / 2, SUGGESTION_LIMIT - manyToOne.length));

    return {
      OneToManyRelationships: oneToMany.slice(0, oneToManyCount),
      ManyToOneRelationships: manyToOne.slice(0, SUGGESTION_LIMIT - oneToManyCount)
    };
  }

  displayEntityName(relation: RelationshipModel | string | null): string {
    if (!relation) {
      return '';
    }

    if (typeof relation === 'string') {
      return relation;
    }

    if (relation.RelationshipType === RelationshipType.OneToMany) {
      return relation.ReferencingEntityName;
    } else if (relation.RelationshipType === RelationshipType.ManyToOne) {
      return relation.ReferencedEntityName;
    }

    return '';
  }

  private handleFullRelationObject(relation: RelationshipModel): void {
    if (relation.SchemaName) {

      if (relation.RelationshipType === RelationshipType.OneToMany) {
        if (relation.ReferencingAttribute) {
          this.fromAttributeFormControl.setValue(relation.ReferencingAttribute);
        }

        if (relation.ReferencedAttribute) {
          this.toAttributeFormControl.setValue(relation.ReferencedAttribute);
        }

      } else if (relation.RelationshipType === RelationshipType.ManyToOne) {

        if (relation.ReferencedAttribute) {
          this.fromAttributeFormControl.setValue(relation.ReferencedAttribute);
        }

        if (relation.ReferencingAttribute) {
          this.toAttributeFormControl.setValue(relation.ReferencingAttribute);
        }
      }
    }
  }
  getAliasName(ReferencingEntityName: string, ReferencedAttribute: string): string {
    return `${ReferencingEntityName.substring(0, 2).toLocaleUpperCase()}_${ReferencedAttribute.substring(0, 2).toLocaleUpperCase()}`;
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}