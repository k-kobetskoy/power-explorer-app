import { Component, OnChanges, OnDestroy, SimpleChanges, ChangeDetectionStrategy, Input, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, Subject, debounceTime, takeUntil, BehaviorSubject } from 'rxjs';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { AttributeEntityService } from '../../../services/entity-services/attribute-entity.service';
import { BaseFormComponent } from '../base-form.component';
import { AttributeData } from '../../../models/constants/attribute-data';
import { QueryNode } from '../../../models/query-node';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { CommonModule } from '@angular/common';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatOptionModule } from '@angular/material/core';
import { QuickActionsComponent } from '../quick-actions/quick-actions.component';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { NodeTreeService } from '../../../services/node-tree.service';
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
    MatInputModule,
    MatAutocompleteModule,
    MatOptionModule,
    QuickActionsComponent,
    MatIconModule,
    MatButtonModule,
    FormsModule,
    MatProgressSpinnerModule,
    NodeActionsComponent,
  ],
  selector: 'app-attribute-form',
  templateUrl: './attribute-form.component.html',
  styleUrls: ['./attribute-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})

export class AttributeFormComponent extends BaseFormComponent implements OnDestroy, OnChanges {
  private destroy$ = new Subject<void>();

  @Input() selectedNode: QueryNode;

  attributeForm: FormGroup;
  filteredAttributes$: Observable<AttributeModel[]>;

  // Add loading indicator state
  isLoadingAttributes$ : BehaviorSubject<boolean>;
  private nameAttributeData = AttributeData.Attribute.Name;
  private aliasAttributeData = AttributeData.Attribute.Alias;

  private nameInputName = this.nameAttributeData.EditorName;
  private aliasInputName = this.aliasAttributeData.EditorName;

  constructor(
    private attributeService: AttributeEntityService,
    private fb: FormBuilder,
    private nodeTreeProcessorService: NodeTreeService,
  ) {
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
    this.attributeForm = this.fb.group({
      [this.nameInputName]: [''],
      [this.aliasInputName]: ['']
    });

    // Before the bindings fill the inputs: the list starts unfiltered
    this.setupAttributeAutocomplete();

    this.setupBindings();
  }

  private setupBindings() {
    [this.nameAttributeData, this.aliasAttributeData].forEach(attributeData => {
      const control = this.attributeForm.get(attributeData.EditorName);

      bindControlToAttribute(control, this.selectedNode, attributeData, this.destroy$, { debounce: 50 });
    });
  }

  private setupAttributeAutocomplete() {
    const attributes$ = parentEntityMetadata$<AttributeModel[]>(this.selectedNode.getParentEntity(), {
      load: entityName => this.attributeService.getAttributes(entityName, true),
      empty: [],
      loading$: this.isLoadingAttributes$
    });

    this.filteredAttributes$ = suggestions$(this.attributeForm.get(this.nameInputName), attributes$).pipe(
      debounceTime(50),
      takeUntil(this.destroy$)
    );
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}