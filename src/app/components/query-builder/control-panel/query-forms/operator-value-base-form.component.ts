import { Input, OnChanges, OnDestroy, SimpleChanges, Component, ChangeDetectionStrategy } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subject, BehaviorSubject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { AttributeNames } from 'src/app/components/query-builder/models/constants/attribute-names';
import { AttributeData } from '../../models/constants/attribute-data';
import { FilterStaticData } from '../../models/constants/ui/filter-static-data';
import { QueryNode } from '../../models/query-node';
import { BaseFormComponent } from './base-form.component';
import { MultiValueNodesService } from '../../services/multi-value-nodes.service';
import { bindControlToAttribute } from './helpers/attribute-binding';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class OperatorValueBaseFormComponent extends BaseFormComponent implements OnDestroy, OnChanges {
    protected destroy$ = new Subject<void>();

    operatorFormControl = new FormControl('');
    valueFormControl = new FormControl('');

    showMultiValueInput$ = new BehaviorSubject<boolean>(false);

    @Input() attributeValue: string;
    @Input() selectedNode: QueryNode;

    // List of operators that require multi-value handling
    protected multiValueOperators = ['in', 'not-in', 'between', 'not-between'];

    constructor(protected multiValueNodesService: MultiValueNodesService) {
        super();
    }

    // The only initialization point: runs when the form gets its node and every time the node
    // or the condition attribute changes. Forms are reused, so nothing may survive from the previous node
    ngOnChanges(changes: SimpleChanges) {
        if ((changes['selectedNode'] || changes['attributeValue']) && this.selectedNode) {
            this.destroy$.next();
            this.initializeForm();
        }
    }

    protected initializeForm() {

        if (!this.selectedNode) return;

        this.operatorFormControl.reset('', { emitEvent: false });
        this.valueFormControl.reset('', { emitEvent: false });

        this.setupBindings();

        this.showMultiValueInput$.next(this.isMultiValueOperator(this.operatorFormControl.value));
    }

    private setupBindings() {
        bindControlToAttribute(this.operatorFormControl, this.selectedNode, AttributeData.Condition.Operator, this.destroy$, {
            canWrite: value => value !== undefined
        });

        // Values of multi-value operators are value nodes, written by the multi-value input
        bindControlToAttribute(this.valueFormControl, this.selectedNode, AttributeData.Condition.Value, this.destroy$, {
            canWrite: value => value !== undefined && !this.isMultiValueOperator(this.operatorFormControl.value)
        });

        // Subscribed after the binding above: the node already has the new operator
        this.operatorFormControl.valueChanges
            .pipe(takeUntil(this.destroy$))
            .subscribe(operator => {
                if (operator === undefined) return;

                this.adjustValuesToOperator(operator);
                this.showMultiValueInput$.next(this.isMultiValueOperator(operator));
            });
    }

    // Leaves in the node only the kind of value the operator takes
    private adjustValuesToOperator(operator: string) {
        if (this.isMultiValueOperator(operator)) {
            this.selectedNode.removeAttribute(AttributeNames.conditionValue);
            return;
        }

        this.multiValueNodesService.clearValueNodes(this.selectedNode);

        if (FilterStaticData.ValuelessOperators.includes(operator)) {
            this.selectedNode.removeAttribute(AttributeNames.conditionValue);
        } else if (!this.getAttribute(AttributeData.Condition.Value, this.selectedNode)) {
            this.updateAttribute(AttributeData.Condition.Value, this.selectedNode, '');
        }
    }

    // Check if the operator is a multi-value operator
    protected isMultiValueOperator(operatorValue: string): boolean {
        return this.multiValueOperators.includes(operatorValue?.toLowerCase());
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }
}
