import { ChangeDetectionStrategy, Component } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { BooleanModel } from 'src/app/models/incoming/boolean/boolean-model';
import { BooleanEntityService } from '../../../../services/entity-services/boolean-entity.service';
import { FilterStaticData } from '../../../../models/constants/ui/filter-static-data';
import { OperatorValueBaseFormComponent } from '../../operator-value-base-form.component';
import { MultiValueNodesService } from 'src/app/components/query-builder/services/multi-value-nodes.service';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatOptionModule } from '@angular/material/core';
import { MultiValueFormComponent } from '../multi-value-form/multi-value-form.component';
import { parentEntityMetadata$ } from '../../helpers/entity-metadata';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete'; 
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatOptionModule,
    MultiValueFormComponent,
    MatSelectModule,    
    MatAutocompleteModule,
    MatButtonModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule
  ],  
  selector: 'app-boolean-form',
  templateUrl: './boolean-form.component.html',
  styleUrls: ['./boolean-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BooleanFormComponent extends OperatorValueBaseFormComponent {
  booleanOptions$: Observable<BooleanModel>;
  isLoading$ : BehaviorSubject<boolean>;

  readonly filterOperators = FilterStaticData.FilterBooleanOperators;

  constructor(
    private booleanService: BooleanEntityService, multiValueNodesSvc: MultiValueNodesService) { 
      super(multiValueNodesSvc); 
    }

  protected override initializeForm() {
    super.initializeForm();
    this.isLoading$ = this.booleanService.getBooleanValuesIsLoading$;
    this.setupBooleanOptions();
  }

  private setupBooleanOptions() {
    this.booleanOptions$ = parentEntityMetadata$<BooleanModel>(this.selectedNode.getParentEntity(), {
      load: entityName => this.booleanService.getBooleanValues(entityName, this.attributeValue, true),
      empty: null,
      loading$: this.isLoading$
    }).pipe(takeUntil(this.destroy$));
  }
}
