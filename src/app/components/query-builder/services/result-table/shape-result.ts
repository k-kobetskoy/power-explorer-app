import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { HeaderMetadata, MatTableRawData } from '../xml-executor.service';
import { ColumnPlan, PlannedAttribute, PlannedEntity } from './column-plan';

export interface CellData {
  attributeLogicalName: string;
  attributeRawValue: string;
  attributeFormattedValue?: string;
  lookupLogicalName?: string;
  entityName?: string;
  link?: string;
}

export interface RowData {
  rowIndex: number;
  attributes: Map<string, CellData>;
  rowJson: any;
  dataverseRowLink: string;
}

/** Attribute metadata by entity logical name, then by attribute logical name. */
export type EntityMetadata = Map<string, Map<string, AttributeModel>>;

interface Column {
  /** The property of the response rows that fills the column; null when no row has one */
  dataKey: string | null;
  header: HeaderMetadata;
  entityName?: string;
  attributeLogicalName: string;
}

const LOOKUP_TYPES = ['Lookup', 'Customer', 'Owner'];
const LOOKUP_KEY = /^_(.+)_value$/;

/** The entities whose attribute metadata shapeResult uses. */
export function entitiesNeedingMetadata(plan: ColumnPlan): string[] {
  const names = plan.entities
    .filter((entity, index) => index === 0 || !entity.allAttributes)
    .map(entity => entity.entityName);

  return [...new Set(names)];
}

/**
 * Turns the rows of a response into table data. Columns follow the order of the query. Every property
 * of the rows, annotations aside, ends up in a column: what the query does not explain is shown last
 * under its own name.
 */
export function shapeResult(
  rawData: any[],
  plan: ColumnPlan,
  metadata: EntityMetadata,
  environmentBrowserUrl: string
): MatTableRawData {
  const columns = mapColumns(collectDataKeys(rawData), plan, metadata);

  const header: { [key: string]: HeaderMetadata } = {};
  columns.forEach((column, key) => header[key] = column.header);

  return {
    header,
    rows: rawData.map((row, rowIndex): RowData => ({
      rowIndex,
      attributes: new Map([...columns].map(([key, column]) => [key, toCell(row, column, environmentBrowserUrl)])),
      rowJson: row,
      dataverseRowLink: recordLink(row, plan, environmentBrowserUrl)
    })),
    __original_data: rawData
  };
}

/** The property names of all rows: Dataverse leaves out the properties whose value is null. */
function collectDataKeys(rawData: any[]): string[] {
  const keys = new Set<string>();

  for (const row of rawData) {
    for (const key of Object.keys(row)) {
      // "name@..." annotates a property, "@odata.etag" the row
      if (!key.includes('@')) {
        keys.add(key);
      }
    }
  }

  return [...keys];
}

/** The columns by their key, in display order. */
function mapColumns(dataKeys: string[], plan: ColumnPlan, metadata: EntityMetadata): Map<string, Column> {
  const unclaimed = new Set(dataKeys);
  const claim = (...candidates: string[]) => {
    const found = candidates.find(candidate => unclaimed.has(candidate));
    unclaimed.delete(found);
    return found ?? null;
  };
  const prefixes = resolveLinkPrefixes(dataKeys, plan);
  const labels = plan.entities.map((entity, index) => linkLabel(entity, prefixes[index], plan));

  // The named attributes take their properties first, so that an all-attributes block cannot take them
  const named = plan.entities.map((entity, index) => entity.attributes.map(attribute =>
    namedColumn(entity, attribute, index, prefixes[index], labels[index], metadata, claim)));

  const columns = new Map<string, Column>();
  const add = (key: string, column: Column) => {
    if (!columns.has(key)) {
      columns.set(key, column);
    }
  };

  plan.entities.forEach((entity, index) => {
    named[index].forEach(([key, column]) => add(key, column));

    if (entity.allAttributes) {
      const block = index === 0
        ? primaryBlock(entity, metadata, unclaimed, claim)
        : linkBlock(entity, prefixes[index], labels[index], unclaimed, claim);
      block.forEach(([key, column]) => add(key, column));
    }
  });

  unclaimed.forEach(key => add(key, {
    dataKey: key,
    attributeLogicalName: key,
    header: { logicalName: key, displayName: key, type: undefined }
  }));

  return columns;
}

/**
 * What the column names of a link start with. The generated prefix of an unaliased link is shown only
 * when the table has several such links and the table name would not tell them apart.
 */
function linkLabel(entity: PlannedEntity, prefix: string | null, plan: ColumnPlan): string {
  const ambiguous = plan.entities
    .filter((other, index) => index > 0 && !other.alias && other.entityName === entity.entityName).length > 1;

  return entity.alias ?? (ambiguous ? prefix : null) ?? entity.entityName;
}

function namedColumn(
  entity: PlannedEntity,
  attribute: PlannedAttribute,
  index: number,
  prefix: string | null,
  linkName: string,
  metadata: EntityMetadata,
  claim: (...candidates: string[]) => string | null
): [string, Column] {
  const { name, alias } = attribute;
  const model = metadata.get(entity.entityName)?.get(name);
  const isPrimary = index === 0;

  let dataKey: string | null;
  let key: string;
  let logicalName: string;
  let displayName: string;

  if (isPrimary) {
    // a lookup arrives as _name_value, whether or not the metadata knows that it is one
    dataKey = alias ? claim(alias) : claim(`_${name}_value`, name);
    key = dataKey ?? alias ?? (LOOKUP_TYPES.includes(model?.attributeType) ? `_${name}_value` : name);
    logicalName = alias ?? key;
    displayName = alias ?? (model?.displayName || name);
  } else {
    // for an attribute with its own alias both "x" and "linkalias.x" are accepted
    const candidates = alias
      ? [alias, ...(prefix ? [`${prefix}.${alias}`] : [])]
      : prefix ? [`${prefix}.${name}`, `${prefix}._${name}_value`] : [];
    dataKey = claim(...candidates);
    // without data an unaliased link has no prefix yet; the number keeps its key apart from other links
    key = dataKey ?? alias ?? `${prefix ?? `${entity.entityName}#${index}`}.${name}`;
    const label = `${linkName}.${name}`;
    logicalName = alias ?? dataKey ?? label;
    displayName = alias ?? label;
  }

  return [key, {
    dataKey,
    entityName: entity.entityName,
    attributeLogicalName: name,
    header: { logicalName, displayName, type: model?.attributeType }
  }];
}

/** The attributes known from the metadata and any other property without a link prefix, the primary key first. */
function primaryBlock(
  entity: PlannedEntity,
  metadata: EntityMetadata,
  unclaimed: Set<string>,
  claim: (...candidates: string[]) => string | null
): [string, Column][] {
  const models = metadata.get(entity.entityName) ?? new Map<string, AttributeModel>();
  const dataKeys = new Map<string, string | null>();

  models.forEach((_, name) => dataKeys.set(name, claim(`_${name}_value`, name)));

  for (const dataKey of [...unclaimed]) {
    const name = LOOKUP_KEY.exec(dataKey)?.[1] ?? dataKey;

    if (!dataKey.includes('.') && !dataKeys.get(name)) {
      dataKeys.set(name, claim(dataKey));
    }
  }

  const primaryId = `${entity.entityName}id`;
  const names = [...dataKeys.keys()].sort((a, b) =>
    Number(b === primaryId) - Number(a === primaryId) || a.localeCompare(b));

  return names.map(name => {
    const model = models.get(name);

    return [name, {
      dataKey: dataKeys.get(name),
      entityName: entity.entityName,
      attributeLogicalName: name,
      header: { logicalName: name, displayName: model?.displayName || name, type: model?.attributeType }
    }];
  });
}

/** What the response holds under the prefix of the link: its columns are not known before that. */
function linkBlock(
  entity: PlannedEntity,
  prefix: string | null,
  linkName: string,
  unclaimed: Set<string>,
  claim: (...candidates: string[]) => string | null
): [string, Column][] {
  if (!prefix) {
    return [];
  }

  return [...unclaimed]
    .filter(key => key.startsWith(`${prefix}.`))
    .sort((a, b) => a.localeCompare(b))
    .map(key => {
      const property = key.substring(prefix.length + 1);
      const name = LOOKUP_KEY.exec(property)?.[1] ?? property;

      return [key, {
        dataKey: claim(key),
        entityName: entity.entityName,
        attributeLogicalName: name,
        header: { logicalName: key, displayName: `${linkName}.${name}`, type: undefined }
      }];
    });
}

/**
 * The property prefix of every entity of the plan (null for the primary one). A link without an alias
 * gets one from Dataverse, "<table><number>". The number is not computed: the prefixes found in the
 * response are handed to the unaliased links of the table in document order.
 */
function resolveLinkPrefixes(dataKeys: string[], plan: ColumnPlan): (string | null)[] {
  const prefixes = plan.entities.map((entity, index) => index === 0 ? null : entity.alias);
  const aliases = new Set(prefixes);

  const properties = new Map<string, string[]>();
  for (const key of dataKeys) {
    const dot = key.indexOf('.');

    if (dot > 0) {
      const prefix = key.substring(0, dot);
      properties.set(prefix, [...properties.get(prefix) ?? [], key.substring(dot + 1)]);
    }
  }

  const unaliased = plan.entities
    .map((entity, index) => ({ entity, index }))
    .filter(({ entity, index }) => index > 0 && !entity.alias);

  for (const table of new Set(unaliased.map(({ entity }) => entity.entityName))) {
    const links = unaliased.filter(({ entity }) => entity.entityName === table);
    const generated = [...properties.keys()]
      .filter(prefix => !aliases.has(prefix) && prefix.startsWith(table) && /^\d+$/.test(prefix.substring(table.length)))
      .sort((a, b) => Number(a.substring(table.length)) - Number(b.substring(table.length)));

    if (generated.length >= links.length) {
      links.forEach(({ index }, position) => prefixes[index] = generated[position]);
      continue;
    }

    // Some link returned nothing (no match in any row, or no columns at all). A link goes to a prefix
    // holding one of its attributes; links naming attributes choose before the all-attributes ones.
    const free = new Set(generated);
    const bySelectivity = [...links].sort((a, b) => Number(a.entity.allAttributes) - Number(b.entity.allAttributes));

    for (const { entity, index } of bySelectivity) {
      const match = [...free].find(prefix => entity.allAttributes || properties.get(prefix).some(property =>
        entity.attributes.some(({ name, alias }) =>
          alias ? property === alias : property === name || property === `_${name}_value`)));

      if (match) {
        prefixes[index] = match;
        free.delete(match);
      }
    }
  }

  return prefixes;
}

function toCell(row: any, column: Column, environmentBrowserUrl: string): CellData {
  const { dataKey, entityName, attributeLogicalName } = column;
  const cell: CellData = { attributeLogicalName, entityName, attributeRawValue: row[dataKey] ?? '' };

  const formattedValue = row[`${dataKey}@OData.Community.Display.V1.FormattedValue`];
  if (formattedValue !== undefined) {
    cell.attributeFormattedValue = formattedValue;
  }

  const lookupLogicalName = row[`${dataKey}@Microsoft.Dynamics.CRM.lookuplogicalname`];
  if (cell.attributeRawValue && lookupLogicalName) {
    cell.lookupLogicalName = lookupLogicalName;
    cell.link = recordUrl(environmentBrowserUrl, lookupLogicalName, cell.attributeRawValue);
  }

  return cell;
}

/** Empty when the row is not a record: aggregate rows, or no primary id as with "distinct". */
function recordLink(row: any, plan: ColumnPlan, environmentBrowserUrl: string): string {
  const primary = plan.entities[0];
  const primaryId = `${primary.entityName}id`;
  // an aliased primary id is returned under the alias
  const alias = primary.attributes.find(attribute => attribute.name === primaryId && attribute.alias)?.alias;
  const id = row[primaryId] ?? row[alias];

  return !plan.aggregate && id && environmentBrowserUrl
    ? recordUrl(environmentBrowserUrl, primary.entityName, id)
    : '';
}

function recordUrl(environmentBrowserUrl: string, entityName: string, id: string): string {
  return `${environmentBrowserUrl}/main.aspx?forceUCI=1&pagetype=entityrecord&etn=${entityName}&id=${id}`;
}
