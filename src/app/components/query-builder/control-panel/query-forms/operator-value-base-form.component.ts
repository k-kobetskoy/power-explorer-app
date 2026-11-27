import { Input, OnChanges, OnDestroy, SimpleChanges, Component, ChangeDetectionStrategy } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subject, BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, takeUntil } from 'rxjs/operators';
import { AttributeNames } from 'src/app/components/query-builder/models/constants/attribute-names';
import { AttributeData } from '../../models/constants/attribute-data';
import { QueryNode } from '../../models/query-node';
import { BaseFormComponent } from './base-form.component';
import { MultiValueNodesService } from '../../services/multi-value-nodes.service';

@Component({ template: '', changeDetection: ChangeDetectionStrategy.OnPush })
export class OperatorValueBaseFormComponent extends BaseFormComponent implements OnDestroy, OnChanges {
    protected destroy$ = new Subject<void>();

   // operatorFormControl = new FormControl(FilterStaticData.FilterBooleanOperators[0].value);
    operatorFormControl = new FormControl('');
    valueFormControl = new FormControl('');
    
    // Add multi-value control for all child components
    multiValueControl = new FormControl('');
    showMultiValueInput$ = new BehaviorSubject<boolean>(false);

    @Input() attributeValue: string;
    @Input() selectedNode: QueryNode;

    // List of operators that require multi-value handling
    protected multiValueOperators = ['in', 'not-in', 'between', 'not-between'];

    constructor(protected multiValueNodesService?: MultiValueNodesService) {
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
        this.multiValueControl.reset('', { emitEvent: false });

        // Emits the current attributes right away, which fills the controls
        this.setupModelToFormBindings();
        this.setupFormToModelBindings();

        if (this.multiValueNodesService) {
            this.setupMultiValueHandling();
        }

        this.showMultiValueInput$.next(!!this.multiValueNodesService && this.isMultiValueOperator(this.operatorFormControl.value));
    }

    protected setupModelToFormBindings() {
        this.selectedNode.attributes$
            .pipe(
                distinctUntilChanged(),
                takeUntil(this.destroy$)
            )
            .subscribe(attributes => {
                const operator = attributes.find(attr => attr.editorName === AttributeNames.conditionOperator);
                const value = attributes.find(attr => attr.editorName === AttributeNames.conditionValue);

                if (!operator) {
                    if (this.operatorFormControl.value) {
                        this.operatorFormControl.setValue(null, { emitEvent: false });
                    }
                } else if (operator.value$.value !== this.operatorFormControl.value) {
                    this.operatorFormControl.setValue(operator.value$.value, { emitEvent: false });
                }

                if (!value) {
                    if (this.valueFormControl.value) {
                        this.valueFormControl.setValue(null, { emitEvent: false });
                    }
                } else if (value.value$.value !== this.valueFormControl.value) {
                    this.valueFormControl.setValue(value.value$.value, { emitEvent: false });
                }
            });
    }

    protected setupFormToModelBindings() {
        // No distinctUntilChanged here and below: the model also changes the controls (without an event),
        // so a value equal to the last emitted one can still be a change
        this.operatorFormControl.valueChanges
            .pipe(
                takeUntil(this.destroy$)
            )
            .subscribe(value => {
                if (value !== undefined) {
                    // Update the operator attribute
                    this.updateAttribute(AttributeData.Condition.Operator, this.selectedNode, value);
                    
                    // Handle multi-value operators
                    if (this.isMultiValueOperator(value)) {
                        this.handleMultiValueOperator();
                    } else {
                        // For single-value operators, ensure we have a value attribute
                        this.ensureValueAttribute();
                    }
                }
            });

        this.valueFormControl.valueChanges
            .pipe(
                takeUntil(this.destroy$)
            )
            .subscribe(value => {
                if (value !== undefined) {
                    const currentOperator = this.operatorFormControl.value;
                    
                    if (this.isMultiValueOperator(currentOperator)) {
                        this.handleMultiValueInput(value);
                    } else {
                        this.updateAttribute(AttributeData.Condition.Value, this.selectedNode, value);
                    }
                }
            });
    }
    
    // Setup multi-value handling for all components
    private setupMultiValueHandling() {
        // Listen to operator changes to handle switching between single and multi-value
        this.operatorFormControl.valueChanges
            .pipe(
                takeUntil(this.destroy$)
            )
            .subscribe(value => {
                // Toggle multi-value input visibility based on operator
                this.showMultiValueInput$.next(this.isMultiValueOperator(value));
                
                if (this.isMultiValueOperator(value)) {
                    // Start with an empty input when switching to multi-value operator
                    this.multiValueControl.setValue('', { emitEvent: false });
                }
            });
    }
    
    // Method to be called when the multi-value input loses focus
    onMultiValueBlur(): void {
        if (this.multiValueNodesService && this.isMultiValueOperator(this.operatorFormControl.value)) {
            this.processMultiValues();
        }
    }
    
    // Method to be called when Enter is pressed in the multi-value input
    onMultiValueEnter(event: Event): void {
        event.preventDefault();
        if (this.multiValueNodesService && this.isMultiValueOperator(this.operatorFormControl.value)) {
            this.processMultiValues();
        }
    }
    
    // Process multi-values and create value nodes
    protected processMultiValues(): void {
        if (this.multiValueNodesService) {
            this.multiValueNodesService.processMultiValues(this.selectedNode, this.multiValueControl.value);
            // Clear the input field after processing values
            this.multiValueControl.setValue('', { emitEvent: false });
        }
    }

    // Check if the operator is a multi-value operator
    protected isMultiValueOperator(operatorValue: string): boolean {
        return this.multiValueOperators.includes(operatorValue?.toLowerCase());
    }

    // Handle changing to a multi-value operator
    protected handleMultiValueOperator() {
        // Remove single value attribute when switching to multi-value operator
        this.selectedNode.removeAttribute(AttributeNames.conditionValue);
    }

    // Ensure value attribute exists for single-value operators
    protected ensureValueAttribute() {
        // First, clear any value nodes from previous multi-value operator
        if (this.multiValueNodesService) {
            this.multiValueNodesService.clearValueNodes(this.selectedNode);
        }
        
        // Then ensure value attribute exists
        const value = this.getAttribute(AttributeData.Condition.Value, this.selectedNode);
        if (!value) {
            this.updateAttribute(AttributeData.Condition.Value, this.selectedNode, '');
        }
    }

    protected handleMultiValueInput(inputValue: string) {
        // Default implementation - now handled by processMultiValues
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }
} 