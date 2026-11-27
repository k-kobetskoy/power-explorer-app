import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, Subject, Subscription } from 'rxjs';
import { QueryNodeTree } from '../models/query-node-tree';
import { AppEvents } from 'src/app/services/event-bus/app-events';
import { EventBusService } from 'src/app/services/event-bus/event-bus.service';
import { QueryNode } from '../models/query-node';
import { QueryNodeData } from '../models/constants/query-node-data';
import { ConditionAttributeData, ValueAttributeData } from '../models/constants/attribute-data';
import { FilterStaticData } from '../models/constants/ui/filter-static-data';
import { NodeFactoryService } from './attribute-services/node-factory.service';
import { VALID_RESULT, ValidationResult, ValidationService } from './validation.service';
import { AttributeNames } from '../models/constants/attribute-names';
import { tap, shareReplay } from 'rxjs/operators';
import { ColumnPlan, buildColumnPlan } from './result-table/column-plan';
@Injectable({ providedIn: 'root' })
export class NodeTreeService {
  private _nodeTree$: BehaviorSubject<QueryNodeTree> = new BehaviorSubject<QueryNodeTree>(null);

  xmlRequest$: BehaviorSubject<string> = new BehaviorSubject<string>('');

  private _selectedNode$: BehaviorSubject<QueryNode> = new BehaviorSubject<QueryNode>(null);

  /** Validation of the whole query. One stream for the lifetime of the service; it follows tree replacements. */
  validationResult$: Observable<ValidationResult>;

  // Keeps the validation active even if the UI doesn't subscribe yet
  private validationSubscription: Subscription = null;

  private _treeChanged$ = new Subject<void>();

  /**
   * Emits when the query changes: a node is added or removed, or an attribute of a node is added,
   * removed or changes its value. Not emitted for a tree replaced by Parse (see replaceNodeTree).
   */
  public get treeChanged$(): Observable<void> {
    return this._treeChanged$.asObservable();
  }

  public get selectedNode$(): Observable<QueryNode> {
    return this._selectedNode$.asObservable();
  }

  public set selectedNode$(value: QueryNode) {
    if (value != this._selectedNode$.value) {
      this._selectedNode$.next(value);
    }
  }

  constructor(
    private _eventBus: EventBusService,
    private nodeFactory: NodeFactoryService,
    private validationService: ValidationService
  ) {
    this.initializeNodeTree();

    this._eventBus.on(AppEvents.ENVIRONMENT_CHANGED, () => this.initializeNodeTree());

    this.setupValidation();
  }

  private setupValidation() {
    // shareReplay keeps the latest result for late subscribers (the Execute button)
    this.validationResult$ = this.validationService.setupNodeTreeValidation(this._nodeTree$)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.validationSubscription = this.validationResult$.subscribe();
  }

  getNodeTree(): BehaviorSubject<QueryNodeTree> {
    if (this._nodeTree$.value) {
      return this._nodeTree$;
    }

    this.initializeNodeTree();

    return this._nodeTree$;
  }

  initializeNodeTree() {
    if (this._nodeTree$.value) {
      return;
    }

    const nodeTree = new QueryNodeTree();

    const rootNode = this.nodeFactory.createNode(QueryNodeData.Fetch.NodeName, false, null);

    nodeTree.root = rootNode;
    rootNode.onTreeChanged = () => this._treeChanged$.next();

    this._nodeTree$.next(nodeTree);

    this._selectedNode$.next(rootNode);

    const attributeFactory = this.nodeFactory.getAttributesFactory(rootNode.nodeName);

    rootNode.addAttribute(attributeFactory.createAttribute(AttributeNames.rootTop, rootNode, false, '10'));

    this.addNode(QueryNodeData.Entity.NodeName);
  }

  addNode(newNodeName: string, parent: QueryNode = null): QueryNode {
    // Map "Link" action to "Link Entity" node name
    if (newNodeName === 'Link') {
      newNodeName = 'Link Entity';
    }

    let parentNode = parent || this._selectedNode$.value;

    let newNode = this.nodeFactory.createNode(newNodeName, false, this._nodeTree$.value.root);

    let nodeAbove = this.getNodeAbove(newNode.order, parentNode);
    let bottomNode = nodeAbove.next;

    nodeAbove.next = newNode;
    newNode.next = bottomNode;

    newNode.level = parentNode.level + 1;
    newNode.parent = parentNode;

    // The default operator belongs to the new node; selecting a node never writes to it
    if (newNodeName === QueryNodeData.Condition.NodeName) {
      newNode.setAttribute(ConditionAttributeData.Operator, FilterStaticData.DefaultOperator);
    }

    if (parent) {
      this.expandNode(parentNode);
    } else {
      this.expandNode(this._selectedNode$.value)
    }

    this.selectedNode$ = newNode;

    // Explicitly emit from nodeTree$ to ensure validation is triggered
    this._nodeTree$.next(this._nodeTree$.value);

    this._eventBus.emit({ name: AppEvents.NODE_ADDED });
    this._treeChanged$.next();

    if (newNodeName === QueryNodeData.Filter.NodeName) {
      const conditionNode = this.addNode(QueryNodeData.Condition.NodeName);
      this.selectedNode$ = conditionNode;
    }

    return newNode;
  }

  addValueNode(parentConditionNode: QueryNode, value: string = ''): QueryNode {
    const valueNode = this.nodeFactory.createNode(QueryNodeData.Value.NodeName, false, this._nodeTree$.value.root);

    let nodeAbove = this.getNodeAbove(valueNode.order, parentConditionNode);
    let bottomNode = nodeAbove.next;

    nodeAbove.next = valueNode;
    valueNode.next = bottomNode;

    valueNode.level = parentConditionNode.level + 1;
    valueNode.parent = parentConditionNode;

    if (value) {
      const attributeFactory = this.nodeFactory.getAttributesFactory(QueryNodeData.Value.NodeName);
      const textAttribute = attributeFactory.createAttribute(
        ValueAttributeData.InnerText.EditorName,
        valueNode,
        false,
        value
      );
      valueNode.addAttribute(textAttribute);
    }

    this.expandNode(parentConditionNode);
    this._eventBus.emit({ name: AppEvents.NODE_ADDED });

    this._nodeTree$.next(this._nodeTree$.value);
    this._treeChanged$.next();

    return valueNode;
  }

  getNodeAbove(newNodeOrder: number, parentNode: QueryNode): QueryNode {
    if (!parentNode) {
      console.error("getNodeAbove called with null/undefined parentNode");
      return null;
    }

    let current = parentNode;
    let newNodeLevel = current.level + 1;

    try {
      while (current) {
        if (!current.next) { break }
        if (current.next.order > newNodeOrder && current.next.level === newNodeLevel) { break }
        if (current.next.level <= parentNode.level) { break }
        current = current.next;
      }
      return current;
    } catch (error) {
      console.error("Error in getNodeAbove:", error);
      console.error("parentNode:", parentNode);
      console.error("newNodeOrder:", newNodeOrder);

      return parentNode;
    }
  }

  removeNode(node: QueryNode) {
    if (!node.parent) {
      throw new Error('Node has no parent.');
    }

    const previousNode = this.getPreviousNode(node);
    const nextNode = this.getNextNodeWithTheSameLevel(node);

    if (!previousNode) {
      throw new Error('Previous node not found.');
    }

    this.cleanupNodeAndChildren(node);

    previousNode.next = nextNode;

    if (nextNode) {
      previousNode.expandable = previousNode.level < previousNode.next.level;
    } else {
      previousNode.expandable = false;
    }

    this._selectedNode$.next(previousNode);

    // Explicitly emit from nodeTree$ to ensure validation is updated after node removal
    this._nodeTree$.next(this._nodeTree$.value);

    this._eventBus.emit({ name: AppEvents.NODE_REMOVED });
    this._treeChanged$.next();
  }

  expandNode(node: QueryNode) {
    node.expandable = true
    if (!node.isExpanded) {
      this.toggleNode(node)
    }
  }

  toggleNode(node: QueryNode) {
    if (!node.expandable) { return; }

    node.isExpanded = !node.isExpanded;

    let parent = node;
    let nextNestedChild = node.next;

    while (nextNestedChild && nextNestedChild.level > parent.level) {
      if (!parent.isExpanded) {
        nextNestedChild.visible = false;
      } else {
        nextNestedChild.visible = nextNestedChild.parent.isExpanded && nextNestedChild.parent.visible;
      }
      nextNestedChild = nextNestedChild.next;
    }

    if (this._selectedNode$ && !this._selectedNode$.value?.visible) {
      this.selectedNode$ = null
    }
  }

  private getNextNodeWithTheSameLevel(node: QueryNode): QueryNode {
    let nextNode = node.next;

    while (nextNode && nextNode.level > node.level) {
      nextNode = nextNode.next;
    }

    return nextNode;
  }

  private getPreviousNode(node: QueryNode): QueryNode {
    const parent = node.parent;

    let previousNode = parent;

    while (previousNode.next !== node) {
      previousNode = previousNode.next;
    }

    return previousNode;
  }

  /**
   * Replaces the whole tree in one step (used by Parse). The new tree must be fully built and detached:
   * one nodeTree$ emission, the new root becomes the selected node, then the old tree is released.
   * treeChanged$ is not emitted; the caller renders the XML itself.
   */
  replaceNodeTree(newTree: QueryNodeTree) {
    const oldTree = this._nodeTree$.value;

    newTree.root.onTreeChanged = () => this._treeChanged$.next();

    this._nodeTree$.next(newTree);
    this._selectedNode$.next(newTree.root);

    if (oldTree && oldTree !== newTree) {
      if (oldTree.root) {
        oldTree.root.onTreeChanged = null;
      }

      oldTree.destroyed$.next();
      oldTree.destroyed$.complete();

      for (const node of [...oldTree]) {
        node.dispose();
      }
    }
  }

  /** What the result columns are mapped from, read from the current tree. */
  getColumnPlan(): ColumnPlan {
    return buildColumnPlan(this._nodeTree$.value.root);
  }

  private cleanupNodeAndChildren(node: QueryNode): void {
    if (!node) return;

    // Dispose the node and its whole subtree (all following nodes with a deeper level)
    let current = node.next;
    node.dispose();

    while (current && current.level > node.level) {
      const next = current.next;
      current.dispose();
      current = next;
    }
  }
}
