import { Component, Input, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy } from '@angular/core';
import { BaseFormComponent } from '../base-form.component';
import { FormControl, FormsModule, ReactiveFormsModule    } from '@angular/forms';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { AttributeEntityService } from '../../../services/entity-services/attribute-entity.service';
import { QueryNode } from '../../../models/query-node';
import { AttributeData } from '../../../models/constants/attribute-data';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CommonModule } from '@angular/common';
import { MatInputModule } from '@angular/material/input';
import { MatOptionModule } from '@angular/material/core';
import { QuickActionsComponent } from '../quick-actions/quick-actions.component';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { NodeTreeService } from 'src/app/components/query-builder/services/node-tree.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { NodeActionsComponent } from '../node-actions/node-actions.component';
import { bindControlToAttribute } from '../helpers/attribute-binding';
import { parentEntityMetadata$ } from '../helpers/entity-metadata';
import { suggestions$ } from '../helpers/suggestions';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatInputModule,
    MatAutocompleteModule,
    MatOptionModule,
    QuickActionsComponent,
    MatIconModule,
    MatButtonModule,
    FormsModule,
    MatProgressSpinnerModule,
    NodeActionsComponent
  ],
  selector: 'app-order-form',
  templateUrl: './order-form.component.html',
  styleUrls: ['./order-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrderFormComponent extends BaseFormComponent implements OnDestroy, OnChanges {
  private destroy$ = new Subject<void>();
  isLoadingAttributes$ : BehaviorSubject<boolean>;
  filteredAttributes$: Observable<AttributeModel[]>;

  attributeFormControl = new FormControl('');
  descendingFormControl = new FormControl(false);

  @Input() selectedNode: QueryNode;

  constructor(private attributeService: AttributeEntityService,
    private nodeTreeService: NodeTreeService) {
    super();
    this.isLoadingAttributes$ = this.attributeService.getAttributesIsLoading$;
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['selectedNode'] && this.selectedNode) {
      this.destroy$.next();
      this.initializeForm();
    }
  }

  private initializeForm() {
    this.setupInitialValues();

    this.setupAttributeAutocomplete();

    this.setupBindings();
  }

  removeNode() {
    this.nodeTreeService.removeNode(this.selectedNode);
  }

  private setupBindings() {
    bindControlToAttribute(this.attributeFormControl, this.selectedNode, AttributeData.Order.Attribute, this.destroy$);

    bindControlToAttribute<boolean>(this.descendingFormControl, this.selectedNode, AttributeData.Order.Desc, this.destroy$, {
      fromModel: value => value === 'true',
      toModel: value => value.toString()
    });
  }

  private setupInitialValues() {
    // Handle attribute initialization
    const attribute = this.getAttribute(AttributeData.Order.Attribute, this.selectedNode);
    if (attribute && attribute.value$ && attribute.value$.value) {
      this.attributeFormControl.setValue(attribute.value$.value, { emitEvent: false });
    } else {
      this.attributeFormControl.setValue('', { emitEvent: false });
    }

    // Handle descending initialization
    const descending = this.getAttribute(AttributeData.Order.Desc, this.selectedNode);
    if (descending && descending.value$) {
      this.descendingFormControl.setValue(descending.value$.value === 'true', { emitEvent: false });
    } else {
      this.descendingFormControl.setValue(false, { emitEvent: false });
    }
  }

  private setupAttributeAutocomplete() {
    const attributes$ = parentEntityMetadata$<AttributeModel[]>(this.selectedNode.getParentEntity(), {
      load: entityName => this.attributeService.getAttributes(entityName, true),
      empty: [],
      loading$: this.isLoadingAttributes$
    });

    this.filteredAttributes$ = suggestions$(this.attributeFormControl, attributes$).pipe(takeUntil(this.destroy$));
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
