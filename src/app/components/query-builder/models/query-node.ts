import { INodeValidators } from './../services/attribute-services/abstract/i-node-validators';
import { BehaviorSubject, Observable, Subject, of } from "rxjs";
import { NodeAttribute } from "./node-attribute";
import { INodeData, QueryNodeData } from "./constants/query-node-data";
import { IAttributeData } from "./constants/attribute-data";
import { IAttributeFactory } from "../services/attribute-services/abstract/i-attribute-validators-factory";
import { ValidationResult, VALID_RESULT } from '../services/validation.service';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';

export class QueryNode {
    rootNode: QueryNode;
    defaultNodeDisplayValue: string;
    order: number;
    attributes$: BehaviorSubject<NodeAttribute[]> = new BehaviorSubject<NodeAttribute[]>([]);
    attributesCount: number;
    expandable: boolean;
    nodeName: string; // Fetch, Entity+, Condition +, Attribute +, Filter +/-, Link, Order, Value +
    tagName: string; // fetch, entity, condition, attribute, filter, link, order, value
    id?: string;
    actions?: string[];
    level?: number;
    isExpanded?: boolean;
    next?: QueryNode | null;
    parent?: QueryNode | null; // This is the parent node not the node above. 
    visible: boolean;
    entitySetName$: BehaviorSubject<string> = new BehaviorSubject<string>(null);
    relationship$?: BehaviorSubject<string> = new BehaviorSubject<string>(null);
    showOnlyLookups$?: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
    tagDisplayValue$: Observable<string>;
    nodeDisplayValue$: Observable<string>;

    validatiors: INodeValidators;
    validationResult$: Observable<ValidationResult>;

    //TODO: implement this functionality later
    hasAggregateOrGroupByAttribute: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

    private readonly attributeFactory: IAttributeFactory;

    destroyed$ = new Subject<void>();

    /**
     * Set by NodeTreeService on the root node of the active tree. Called whenever an attribute
     * of any node in that tree is added, removed or changes its value. Null on detached trees.
     */
    onTreeChanged: (() => void) | null = null;

    constructor(
        nodeData: INodeData,
        attributeFactory: IAttributeFactory,
        nodeValidators: INodeValidators,
        rootNode: QueryNode
    ) {
        this.expandable = false;
        this.level = 0;
        this.visible = true;
        this.isExpanded = true;
        this.next = null;

        this.defaultNodeDisplayValue = nodeData.NodeName;
        this.nodeName = nodeData.NodeName;
        this.tagName = nodeData.TagName;
        this.order = nodeData.Order;
        this.actions = nodeData.Actions;
        this.attributesCount = nodeData.AttributesCount;

        this.tagDisplayValue$ = new BehaviorSubject<string>(this.defaultNodeDisplayValue);

        this.attributeFactory = attributeFactory;
        this.validatiors = nodeValidators;
        this.rootNode = rootNode;
    }

    getRootNode(): QueryNode {
        if (this.nodeName === QueryNodeData.Fetch.NodeName) {
            return this;
        }

        return this.rootNode;
    }

    getParentEntity(node: QueryNode = this): QueryNode {
        if (node.nodeName === QueryNodeData.Fetch.NodeName) {
            return null;
        }

        const parent = node.parent;

        if (!parent) {
            return null; // Return null instead of throwing an error
        }

        if (parent?.nodeName === QueryNodeData.Entity.NodeName || parent?.nodeName === QueryNodeData.Link.NodeName) {
            return parent;
        } else {
            return this.getParentEntity(parent);
        }
    }

    getParentEntityName(parentEntityNode: QueryNode): BehaviorSubject<string> {
        if (!parentEntityNode) {
            return new BehaviorSubject<string>('');
        }

        const nameAttribute = parentEntityNode.attributes$.value.find(a => a.editorName === 'name');
        if (!nameAttribute) {
            return new BehaviorSubject<string>('');
        }

        return nameAttribute.value$;
    }

    setAttribute(attributeData: IAttributeData, value: string, atributeModel: AttributeModel = null): void {
        try {
            const attribute = this.findAttribute(attributeData.EditorName);

            if (!attribute) {
                this.createAttributeWithValue(attributeData.EditorName, value, atributeModel);
                return;
            }

            if (attribute.value$.value !== value) {
                attribute.value$.next(value);
                if (atributeModel) {
                    attribute.setAttributeModel(atributeModel);
                }
                this.notifyTreeChanged();
            }
        } catch (error) {
            console.error(`[QueryNode] Error in setAttribute: ${error}`);
        }
    }

    // The value is set before the attribute is published: forms copy it into their inputs as soon as
    // attributes$ emits, so an empty value there would wipe what the user has just entered
    private createAttributeWithValue(attributeName: string, value: string, attributeModel: AttributeModel): void {
        const attribute = this.attributeFactory.createAttribute(attributeName, this, false);
        attribute.value$.next(value);
        if (attributeModel) {
            attribute.setAttributeModel(attributeModel);
        }
        this.addAttribute(attribute);
    }

    findAttribute(attributeName: string): NodeAttribute | undefined {
        const attribute = this.attributes$.value.find(a => a.editorName === attributeName);
        return attribute;
    }

    removeAttribute(attributeName: string): void {
        const attributes = this.attributes$.value;
        const index = attributes.findIndex(a => a.editorName === attributeName);
        
        if (index !== -1) {
            const attributeToRemove = attributes[index];
            attributeToRemove.dispose(); // Clean up subscriptions
            this.attributes$.next(attributes.filter((_, i) => i !== index));
            this.notifyTreeChanged();
        }
    }

    getOrCreateAttribute(attributeName: string): NodeAttribute | undefined {
        return this.findAttribute(attributeName);
    }

    addAttribute(attribute: NodeAttribute): void {
        // Always a new array: subscribers compare emissions, so the emitted one must never be mutated.
        // The sort is stable, so attributes of the same order (unknown ones) keep their insertion order
        const attributes = [...this.attributes$.value, attribute].sort((a, b) => a.order - b.order);

        this.attributes$.next(attributes);
        this.notifyTreeChanged();
    }

    private notifyTreeChanged(): void {
        (this.rootNode ?? this).onTreeChanged?.();
    }

    public dispose(): void {
        this.attributes$.value.forEach(attribute => attribute.dispose());
        this.destroyed$.next();
        this.destroyed$.complete();
    }
}