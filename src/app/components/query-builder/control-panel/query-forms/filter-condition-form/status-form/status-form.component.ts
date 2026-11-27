import { ChangeDetectionStrategy, Component } from '@angular/core';
import { OperatorValueBaseFormComponent } from '../../operator-value-base-form.component';
import { StatusEntityService } from 'src/app/components/query-builder/services/entity-services/status-entity.service';
import { MultiValueNodesService } from 'src/app/components/query-builder/services/multi-value-nodes.service';
import { FilterStaticData } from 'src/app/components/query-builder/models/constants/ui/filter-static-data';
import { StateModel } from 'src/app/models/incoming/status/state-response-model';
import { Observable, takeUntil } from 'rxjs';
import { MatInputModule } from '@angular/material/input';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatOptionModule } from '@angular/material/core';
import { QuickActionsComponent } from '../../quick-actions/quick-actions.component';
import { MultiValueFormComponent } from '../multi-value-form/multi-value-form.component';
import { parentEntityMetadata$ } from '../../helpers/entity-metadata';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';

@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatAutocompleteModule,
    MatOptionModule,
    MultiValueFormComponent,
    MatButtonModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule
  ],  
  selector: 'app-status-form',
  templateUrl: './status-form.component.html',
  styleUrls: ['./status-form.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StatusFormComponent extends OperatorValueBaseFormComponent {

  readonly filterOperators = FilterStaticData.FilterPickListOperators;
  statusOptions$: Observable<StateModel[]>;

  constructor(
    private statusService: StatusEntityService, 
    multiValueNodesSvc: MultiValueNodesService) {
    super(multiValueNodesSvc);
  }
  protected override initializeForm() {
    super.initializeForm();
    this.setupStatusOptions();
  }

  private setupStatusOptions() {
    this.statusOptions$ = parentEntityMetadata$<StateModel[]>(this.selectedNode.getParentEntity(), {
      load: entityName => this.statusService.getStateOrStatusCodeValues(entityName, this.attributeValue, true),
      empty: [],
      loading$: this.statusService.getStateOrStatusCodeValuesIsLoading$
    }).pipe(takeUntil(this.destroy$));
  }
}
