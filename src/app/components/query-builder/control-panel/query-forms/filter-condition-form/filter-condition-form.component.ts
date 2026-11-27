import { Component, Input, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject, takeUntil, BehaviorSubject, debounceTime } from 'rxjs';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { AttributeEntityService } from 'src/app/components/query-builder/services/entity-services/attribute-entity.service';
import { AttributeType } from '../../../models/constants/dataverse/attribute-types';
import { FilterOperatorTypes } from '../../../models/constants/ui/option-set-types';
import { QueryNode } from '../../../models/query-node';
import { AttributeData } from '../../../models/constants/attribute-data';
import { BaseFormComponent } from '../base-form.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CommonModule } from '@angular/common';
import { MatInputModule } from '@angular/material/input';
import { QuickActionsComponent } from '../quick-actions/quick-actions.component';
import { MatOptionModule } from '@angular/material/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { ScalarValueFormComponent } from './scalar-value-form/scalar-value-form.component';
import { BooleanFormComponent } from './boolean-form/boolean-form.component';
import { PicklistFormComponent } from './picklist-form/picklist-form.component';
import { StatusFormComponent } from './status-form/status-form.component';
import { StringFormComponent } from './string-form/string-form.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { NodeTreeService } from 'src/app/components/query-builder/services/node-tree.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NodeActionsComponent } from '../node-actions/node-actions.component';
import { MultiValueNodesService } from '../../../services/multi-value-nodes.service';
import { FilterStaticData } from '../../../models/constants/ui/filter-static-data';
import { bindControlToAttribute } from '../helpers/attribute-binding';
import { parentEntityMetadata$ } from '../helpers/entity-metadata';
import { suggestions$ } from '../helpers/suggestions';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    QuickActionsComponent,
    MatOptionModule,
    MatAutocompleteModule,
    ScalarValueFormComponent,
    BooleanFormComponent,
    PicklistFormComponent,
    StatusFormComponent,
    StringFormComponent,
    MatIconModule,
    MatButtonModule,
    FormsModule,
    MatProgressSpinnerModule,
    NodeActionsComponent
  ],
  selector: 'app-filter-condition-form',
  templateUrl: './filter-condition-form.component.html',
  styleUrls: ['./filter-condition-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class FilterConditionFormComponent extends BaseFormComponent implements OnChanges, OnDestroy {
  private _destroy$ = new Subject<void>();

  private readonly conditionAttribute = AttributeData.Condition.Attribute;
  private readonly conditionOperator = AttributeData.Condition.Operator;
  private readonly conditionValue = AttributeData.Condition.Value;

  @Input() selectedNode: QueryNode;
  // The attribute the operator and the value of the node belong to
  private committedAttribute = '';
  private knownAttributes: AttributeModel[] = [];

  isLoadingAttributes$: BehaviorSubject<boolean>;

  attributes$: Observable<AttributeModel[]>;
  filteredAttributes$: Observable<AttributeModel[]>;
  selectedAttribute$: BehaviorSubject<AttributeModel> = new BehaviorSubject<AttributeModel>(null);
  FilterOperatorTypes = FilterOperatorTypes;

  attributeFormControl = new FormControl('');

  constructor(
    private attributeEntityService: AttributeEntityService,
    private nodeTreeService: NodeTreeService,
    private multiValueNodesService: MultiValueNodesService) {
    super();
    this.isLoadingAttributes$ = this.attributeEntityService.getAttributesIsLoading$;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selectedNode'] && this.selectedNode) {
      this._destroy$.next();
      this.initializeForm();
    }
  }

  private initializeForm() {

    this.setInputInitialValues();

    this.setupAttributesSubscription();

    this.setupSelectedAttribute();

    bindControlToAttribute(this.attributeFormControl, this.selectedNode, this.conditionAttribute, this._destroy$);

    this.filteredAttributes$ = suggestions$(this.attributeFormControl, this.attributes$).pipe(debounceTime(50));
  }

  removeNode() {
    this.nodeTreeService.removeNode(this.selectedNode);
  }

  setupAttributesSubscription() {
    this.attributes$ = parentEntityMetadata$<AttributeModel[]>(this.selectedNode.getParentEntity(), {
      load: entityName => this.attributeEntityService.getAttributes(entityName, true),
      empty: [],
      loading$: this.isLoadingAttributes$
    }).pipe(takeUntil(this._destroy$));
  }

  private setInputInitialValues() {
    const value = this.getAttribute(this.conditionAttribute, this.selectedNode)?.value$.value ?? '';

    this.attributeFormControl.reset(value, { emitEvent: false });
    this.committedAttribute = value;
    this.knownAttributes = [];
    this.selectedAttribute$.next(null);
  }

  // Shows the operator and value inputs for the attribute the node already has. Does not write to the model
  private setupSelectedAttribute() {
    this.attributes$.subscribe(attributes => {
      this.knownAttributes = attributes;

      const attribute = this.findAttributeModel(this.committedAttribute);
      if (attribute) {
        this.selectedAttribute$.next(attribute);
      }
    });
  }

  // The user has chosen an attribute: an option of the list, or a typed name confirmed by Enter or by leaving the input
  commitAttribute(value: string) {
    const attribute = this.findAttributeModel(value);
    if (!attribute) {
      this.commitUncheckedAttribute(value);
      return;
    }

    if (!this.isCommittedAttribute(attribute.logicalName)) {
      this.resetOperatorAndValue();
    }

    this.committedAttribute = attribute.logicalName;
    this.updateAttribute(this.conditionAttribute, this.selectedNode, attribute.logicalName, attribute);
    this.selectedAttribute$.next(attribute);
  }

  // While the columns are loading a name cannot be checked, but the node already holds it: the operator
  // and the value of the previous attribute must go now, the user may leave the node before the list arrives
  private commitUncheckedAttribute(value: string) {
    if (!value || this.knownAttributes.length > 0 || this.isCommittedAttribute(value)) {
      return;
    }

    this.resetOperatorAndValue();
    this.committedAttribute = value;
    // Hides the inputs of the previous attribute; those of the new one appear with the list
    this.selectedAttribute$.next(null);
  }

  private isCommittedAttribute(logicalName: string): boolean {
    return logicalName.toLowerCase() === this.committedAttribute.toLowerCase();
  }

  private findAttributeModel(logicalName: string): AttributeModel | undefined {
    const name = (logicalName ?? '').toLowerCase();
    return this.knownAttributes.find(attr => attr.logicalName.toLowerCase() === name);
  }

  private resetOperatorAndValue() {
    this.multiValueNodesService.clearValueNodes(this.selectedNode);
    this.selectedNode.removeAttribute(this.conditionValue.EditorName);
    // Removed and added again, not overwritten: the operator inputs follow added and removed attributes
    this.selectedNode.removeAttribute(this.conditionOperator.EditorName);
    this.updateAttribute(this.conditionOperator, this.selectedNode, FilterStaticData.DefaultOperator);
  }

  onKeyPressed($event: KeyboardEvent) {
    if (($event.key === 'Delete' || $event.key === 'Backspace') &&
      this.attributeFormControl.value === '') {
    }
  }


  getFilterOperatorType(attribute: AttributeModel) {
    switch (attribute.attributeType) {
      case AttributeType.INTEGER:
      case AttributeType.DECIMAL:
      case AttributeType.BIG_INT:
      case AttributeType.MONEY:
      case AttributeType.DOUBLE:
        return FilterOperatorTypes.NUMBER;
      case AttributeType.DATE_TIME:
        return FilterOperatorTypes.DATE_TIME;
      case AttributeType.BOOLEAN:
        return FilterOperatorTypes.BOOLEAN;
      case AttributeType.UNIQUE_IDENTIFIER:
      case AttributeType.LOOKUP:
      case AttributeType.OWNER:
      case AttributeType.CUSTOMER:
        return FilterOperatorTypes.ID;
      case AttributeType.PICKLIST:
        return FilterOperatorTypes.PICKLIST;
      case AttributeType.STATE:
      case AttributeType.STATUS:
        return FilterOperatorTypes.STATUS;
      default:
        return FilterOperatorTypes.STRING;
    }
  }

  ngOnDestroy(): void {
    this._destroy$.next();
    this._destroy$.complete();
  }
}
