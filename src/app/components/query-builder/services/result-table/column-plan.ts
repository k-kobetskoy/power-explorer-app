import { AttributeNames } from '../../models/constants/attribute-names';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { QueryNode } from '../../models/query-node';

export interface PlannedAttribute {
  readonly name: string | null;
  readonly alias: string | null;
  readonly aggregate: string | null;
  readonly groupBy: boolean;
}

/** The columns one entity or link-entity node contributes to the result. */
export interface PlannedEntity {
  readonly entityName: string;
  /** The alias written in the query; null for the primary entity without one and for unaliased links */
  readonly alias: string | null;
  /** In the order of the query */
  readonly attributes: readonly PlannedAttribute[];
  /**
   * The node names no attributes, so whatever Dataverse returns for it is shown. Never in an aggregate
   * query, where such a node returns no columns.
   */
  readonly allAttributes: boolean;
}

/**
 * What the result columns are mapped from. Plain data without references to query nodes: it is kept
 * for the next pages, while the tree may be edited or replaced by then.
 */
export interface ColumnPlan {
  readonly aggregate: boolean;
  /** The primary entity first, then every link-entity in document order, nested ones included */
  readonly entities: readonly PlannedEntity[];
}

/** Returns a plan without entities when the query has no named primary entity. */
export function buildColumnPlan(root: QueryNode): ColumnPlan {
  const attributesByNode = new Map<QueryNode, PlannedAttribute[]>();
  const entityNodes: QueryNode[] = [];

  // pre-order, so an entity node comes before its attributes and entity nodes come in document order
  for (let node = root?.next; node; node = node.next) {
    if (node.tagName === QueryNodeData.Entity.TagName || node.tagName === QueryNodeData.Link.TagName) {
      entityNodes.push(node);
      attributesByNode.set(node, []);
    } else if (node.tagName === QueryNodeData.Attribute.TagName) {
      const name = valueOf(node, AttributeNames.attributeName);
      const alias = valueOf(node, AttributeNames.attributeAlias);

      if (name || alias) {
        attributesByNode.get(node.parent)?.push({
          name,
          alias,
          aggregate: valueOf(node, AttributeNames.attributeAggregate),
          groupBy: valueOf(node, AttributeNames.attributeGroupBy) === 'true'
        });
      }
    }
  }

  const aggregate = !!root && valueOf(root, AttributeNames.rootAggregate) === 'true';

  if (root?.next?.tagName !== QueryNodeData.Entity.TagName || !valueOf(root.next, AttributeNames.entityName)) {
    return { aggregate, entities: [] };
  }

  const entities = entityNodes
    .filter(node => valueOf(node, AttributeNames.entityName))
    .map((node): PlannedEntity => {
      const attributes = attributesByNode.get(node);

      return {
        entityName: valueOf(node, AttributeNames.entityName),
        alias: valueOf(node, AttributeNames.entityAlias),
        attributes,
        allAttributes: !aggregate && attributes.length === 0
      };
    });

  return { aggregate, entities };
}

function valueOf(node: QueryNode, attributeName: string): string | null {
  return node.findAttribute(attributeName)?.value$.value || null;
}
