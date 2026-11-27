import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { QueryNode } from '../../../../models/query-node';
import { MultiValueNodesService } from '../../../../services/multi-value-nodes.service';

/** Input for the values of In, Between and the like; each value becomes a value node of the condition. */
@Component({
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
        MatButtonModule
    ],
    selector: 'app-multi-value-form',
    templateUrl: './multi-value-form.component.html',
    styleUrls: ['./multi-value-form.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class MultiValueFormComponent implements OnChanges {
    @Input() selectedNode: QueryNode;

    multiValueControl = new FormControl('');

    constructor(private multiValueNodesService: MultiValueNodesService) { }

    // The form is reused: text typed for the previous node must not stay
    ngOnChanges() {
        this.multiValueControl.reset('', { emitEvent: false });
    }

    onMultiValueBlur(): void {
        this.processMultiValues();
    }

    onMultiValueEnter(event: Event): void {
        event.preventDefault();
        this.processMultiValues();
    }

    private processMultiValues(): void {
        this.multiValueNodesService.processMultiValues(this.selectedNode, this.multiValueControl.value);
        this.multiValueControl.setValue('', { emitEvent: false });
    }
}
