import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatOptionModule } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { FilterStaticData } from '../../../../models/constants/ui/filter-static-data';
import { FilterOperatorTypes } from '../../../../models/constants/ui/option-set-types';
import { MultiValueNodesService } from '../../../../services/multi-value-nodes.service';
import { OperatorValueBaseFormComponent } from '../../operator-value-base-form.component';
import { MultiValueFormComponent } from '../multi-value-form/multi-value-form.component';

export type ScalarFilterType = typeof FilterOperatorTypes.NUMBER | typeof FilterOperatorTypes.ID | typeof FilterOperatorTypes.DATE_TIME;

const SCALAR_FILTERS = {
  [FilterOperatorTypes.NUMBER]: {
    operators: FilterStaticData.FilterNumberOperators, inputType: 'text', placeholder: 'Enter numeric value'
  },
  [FilterOperatorTypes.ID]: {
    operators: FilterStaticData.FilterIdOperators, inputType: 'text', placeholder: 'Enter GUID or ID value'
  },
  [FilterOperatorTypes.DATE_TIME]: {
    operators: FilterStaticData.FilterDateTimeOperators, inputType: 'datetime-local', placeholder: 'Choose a date and time'
  },
};

/** Operator and a value typed into one input: number, id and date-time attributes. */
@Component({
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatOptionModule,
    MatSelectModule,
    MatIconModule,
    MatButtonModule,
    MultiValueFormComponent
  ],
  selector: 'app-scalar-value-form',
  templateUrl: './scalar-value-form.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ScalarValueFormComponent extends OperatorValueBaseFormComponent {
  @Input() filterType: ScalarFilterType;

  constructor(multiValueNodesService: MultiValueNodesService) {
    super(multiValueNodesService);
  }

  get settings() {
    return SCALAR_FILTERS[this.filterType];
  }
}
