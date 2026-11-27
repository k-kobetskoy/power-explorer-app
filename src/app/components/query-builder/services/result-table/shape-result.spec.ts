import { TestBed, fakeAsync, flush } from '@angular/core/testing';
import { xml } from '@codemirror/lang-xml';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { NodeTreeService } from '../node-tree.service';
import { provideQueryBuilderTesting } from '../query-builder-test-providers';
import { XmlParseService } from '../xml-parsing-services/xml-parse.service';
import { MatTableRawData } from '../xml-executor.service';
import { ColumnPlan } from './column-plan';
import { aggregate, aliasedLink, outerJoin, twoAliasesAndUnaliased } from './result-columns.fixtures';
import { EntityMetadata, entitiesNeedingMetadata, shapeResult } from './shape-result';

describe('result columns', () => {
  const URL = 'https://org.example.com';
  const model = (logicalName: string, displayName: string, attributeType = 'String'): [string, AttributeModel] =>
    [logicalName, { logicalName, displayName, attributeType }];
  const metadata: EntityMetadata = new Map([
    ['account', new Map([
      model('name', 'Account Name'),
      model('ownerid', 'Owner', 'Owner'),
      model('industrycode', 'Industry', 'Picklist')
    ])],
    ['contact', new Map([model('fullname', 'Full Name'), model('parentcustomerid', 'Company Name', 'Customer')])]
  ]);

  let parseService: XmlParseService;
  let nodeTreeService: NodeTreeService;
  let view: EditorView;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideQueryBuilderTesting() });
    parseService = TestBed.inject(XmlParseService);
    nodeTreeService = TestBed.inject(NodeTreeService);
  });

  afterEach(() => view?.destroy());

  function plan(text: string): ColumnPlan {
    view?.destroy();
    view = new EditorView({ state: EditorState.create({ doc: text.trim(), extensions: [xml()] }) });
    expect(parseService.parseXmlManually(view).success).toBeTrue();
    const columnPlan = nodeTreeService.getColumnPlan();
    flush();
    return columnPlan;
  }

  const shape = (text: string, rows: object[], models = metadata) => shapeResult(rows, plan(text), models, URL);
  // for queries that name no primary attributes: without metadata and primary data only the links have columns
  const shapeLinks = (body: string, rows: object[]) =>
    shape(query(body), rows, new Map([...metadata].filter(([name]) => name !== 'account')));
  const keys = (result: MatTableRawData) => Object.keys(result.header);
  const labels = (result: MatTableRawData) => Object.values(result.header).map(column => column.displayName);
  const values = (result: MatTableRawData, row = 0): unknown[] =>
    keys(result).map(key => result.rows[row].attributes.get(key).attributeRawValue);

  const query = (body: string) => `<fetch><entity name="account">${body}</entity></fetch>`;
  const link = (table: string, attributes: string[], alias = '', nested = '') =>
    `<link-entity name="${table}" from="a" to="b"${alias && ` alias="${alias}"`}>` +
    attributes.map(name => `<attribute name="${name}" />`).join('') + `${nested}</link-entity>`;

  describe('column plan', () => {
    it('keeps every entity node apart, in document order, with its own attributes', fakeAsync(() => {
      const columnPlan = plan(query(
        '<attribute name="name" alias="n" />' +
        link('account', ['name'], 'parent', link('contact', ['fullname'])) +
        link('account', [])));

      const attribute = (name: string, alias: string = null) => ({ name, alias, aggregate: null, groupBy: false });
      expect(columnPlan).toEqual({
        aggregate: false,
        entities: [
          { entityName: 'account', alias: null, attributes: [attribute('name', 'n')], allAttributes: false },
          { entityName: 'account', alias: 'parent', attributes: [attribute('name')], allAttributes: false },
          { entityName: 'contact', alias: null, attributes: [attribute('fullname')], allAttributes: false },
          { entityName: 'account', alias: null, attributes: [], allAttributes: true }
        ]
      });
      expect(entitiesNeedingMetadata(columnPlan)).toEqual(['account', 'contact']);
    }));

    it('records aggregate and groupby', fakeAsync(() => {
      const columnPlan = plan(aggregate.xml);

      expect(columnPlan.aggregate).toBeTrue();
      expect(columnPlan.entities[0].attributes.map(a => `${a.alias}:${a.aggregate}:${a.groupBy}`))
        .toEqual(['AccountCount:count:false', 'Employees:sum:false', 'Owner:null:true', 'Industry:null:true']);
    }));
  });

  it('shows the columns of an aliased link in query order, with the primary id the query did not ask for last', fakeAsync(() => {
    const result = shape(aliasedLink.xml, aliasedLink.rows);

    expect(keys(result)).toEqual(['name', '_ownerid_value', 'pc.fullname', 'pc.parentcustomerid', 'pc.emailaddress1', 'accountid']);
    expect(labels(result)).toEqual(['Account Name', 'Owner', 'pc.fullname', 'pc.parentcustomerid', 'pc.emailaddress1', 'accountid']);
    expect(values(result)).toEqual(['Sample Account A', '00000000-0000-0000-0000-0000000000a1', 'Sample Contact One',
      '00000000-0000-0000-0000-000000000a01', 'contact.one@example.invalid', '00000000-0000-0000-0000-000000000a01']);
    expect(values(result, 1)[4]).toBe('');
    expect(result.rows[0].dataverseRowLink).toContain('etn=account&id=00000000-0000-0000-0000-000000000a01');
  }));

  for (const key of ['pc.parentcustomerid', 'pc._parentcustomerid_value']) {
    it(`maps a lookup inside a link returned as ${key}`, fakeAsync(() => {
      const result = shapeLinks(link('contact', ['parentcustomerid'], 'pc'), [{
        [key]: 'id-1',
        [`${key}@OData.Community.Display.V1.FormattedValue`]: 'Sample Parent',
        [`${key}@Microsoft.Dynamics.CRM.lookuplogicalname`]: 'contact'
      }]);

      expect(keys(result)).toEqual([key]);
      expect(labels(result)).toEqual(['pc.parentcustomerid']);
      expect(result.header[key].type).toBe('Customer');
      const cell = result.rows[0].attributes.get(key);
      expect(cell.attributeFormattedValue).toBe('Sample Parent');
      expect(cell.link).toContain('etn=contact&id=id-1');
    }));
  }

  // "contact3" if aliased links take a number, "contact1" if they do not
  for (const prefix of ['contact3', 'contact1']) {
    it(`keeps two joins of one table apart and finds an unaliased link returned as ${prefix}`, fakeAsync(() => {
      const result = shape(twoAliasesAndUnaliased.xml, twoAliasesAndUnaliased.rows(prefix));

      expect(keys(result)).toEqual(['name', 'cb.fullname', 'mb.fullname', `${prefix}.fullname`, `${prefix}.jobtitle`, 'accountid']);
      expect(labels(result)).toEqual(['Account Name', 'cb.fullname', 'mb.fullname', 'contact.fullname', 'contact.jobtitle', 'accountid']);
      expect(values(result).slice(1, 5)).toEqual(['Sample User One', 'Sample User Two', 'Sample Contact Three', 'Sample Title']);
    }));
  }

  it('does not let a self-join replace the columns of the primary entity', fakeAsync(() => {
    const result = shape(
      query('<attribute name="name" /><attribute name="accountnumber" />' + link('account', ['name'], 'parent')),
      [{ 'name': 'Child', 'accountnumber': '7', 'parent.name': 'Parent' }]);

    expect(keys(result)).toEqual(['name', 'accountnumber', 'parent.name']);
    expect(values(result)).toEqual(['Child', '7', 'Parent']);
  }));

  for (const [alias, prefix] of [[' alias="c"', 'c'], ['', 'contact1']]) {
    it(`finds the linked columns "${prefix}" that the first row does not have`, fakeAsync(() => {
      const result = shape(outerJoin.xml(alias), outerJoin.rows(prefix));

      expect(keys(result)).toEqual(['name', `${prefix}.fullname`, `${prefix}.telephone1`, 'accountid']);
      expect(values(result, 0).slice(0, 3)).toEqual(['Sample Account D', '', '']);
      expect(values(result, 1).slice(0, 3)).toEqual(['Sample Account E', 'Sample Contact Four', '000-000-0000']);
    }));
  }

  it('keeps the columns of an unaliased link that no row has a value for', fakeAsync(() => {
    const result = shape(outerJoin.xml(''), [{ name: 'A' }]);

    expect(labels(result)).toEqual(['Account Name', 'contact.fullname', 'contact.telephone1']);
    expect(keys(result).join()).not.toContain('undefined');
    expect(values(result)).toEqual(['A', '', '']);
  }));

  it('hands generated prefixes to unaliased links of one table by ascending number, nested ones included', fakeAsync(() => {
    const result = shapeLinks(
      link('contact', ['fullname'], '', link('contact', ['fullname'])) + link('contact', ['fullname']),
      [{ 'contact10.fullname': 'third', 'contact2.fullname': 'second', 'contact1.fullname': 'first' }]);

    expect(keys(result)).toEqual(['contact1.fullname', 'contact2.fullname', 'contact10.fullname']);
    expect(labels(result)).toEqual(['contact1.fullname', 'contact2.fullname', 'contact10.fullname']);
    expect(values(result)).toEqual(['first', 'second', 'third']);
  }));

  it('does not give the alias of another link to an unaliased one', fakeAsync(() => {
    const result = shapeLinks(
      link('contact', ['fullname'], 'contact1') + link('contact', ['fullname']),
      [{ 'contact1.fullname': 'aliased', 'contact2.fullname': 'unaliased' }]);

    expect(values(result)).toEqual(['aliased', 'unaliased']);
  }));

  it('matches by attributes when only one of two unaliased links of a table returned something', fakeAsync(() => {
    const result = shapeLinks(
      link('contact', ['fullname']) + link('contact', ['jobtitle']),
      [{ 'contact2.jobtitle': 'Title' }]);

    expect(labels(result)).toEqual(['contact.fullname', 'contact2.jobtitle']);
    expect(values(result)).toEqual(['', 'Title']);
  }));

  it('does not let a link without attributes take the prefix of a link that names them', fakeAsync(() => {
    const result = shapeLinks(
      link('contact', []) + link('contact', ['fullname']),
      [{ 'contact2.fullname': 'Name' }]);

    expect(keys(result)).toEqual(['contact2.fullname']);
    expect(values(result)).toEqual(['Name']);
  }));

  for (const key of ['who', 'pc.who']) {
    it(`maps an aliased attribute of a link returned as ${key}`, fakeAsync(() => {
      const result = shapeLinks(
        '<link-entity name="contact" from="a" to="b" alias="pc"><attribute name="fullname" alias="who" /></link-entity>',
        [{ [key]: 'Name' }]);

      expect(keys(result)).toEqual([key]);
      expect(labels(result)).toEqual(['who']);
      expect(values(result)).toEqual(['Name']);
    }));
  }

  it('shows all primary columns and the linked ones when only the link names attributes', fakeAsync(() => {
    const result = shape(query(link('contact', ['fullname'], 'pc')), [{
      'accountid': 'a-1', 'name': 'A', '_ownerid_value': 'u-1', 'createdon': '2026-01-01', 'pc.fullname': 'Name'
    }]);

    // the primary key and createdon are not in the metadata; industrycode has no value in any row
    expect(keys(result)).toEqual(['accountid', 'createdon', 'industrycode', 'name', 'ownerid', 'pc.fullname']);
    expect(labels(result)).toEqual(['accountid', 'createdon', 'Industry', 'Account Name', 'Owner', 'pc.fullname']);
    expect(values(result)).toEqual(['a-1', '2026-01-01', '', 'A', 'u-1', 'Name']);
  }));

  for (const [alias, prefix] of [[' alias="pc"', 'pc'], ['', 'contact1']]) {
    it(`shows the linked columns "${prefix}" when no node names attributes`, fakeAsync(() => {
      const result = shape(
        query(`<link-entity name="contact" from="a" to="b"${alias} />`),
        [
          { accountid: 'a-1', [`${prefix}.fullname`]: 'Name' },
          { accountid: 'a-2', [`${prefix}._parentcustomerid_value`]: 'c-1' }
        ]);

      expect(keys(result).slice(-2)).toEqual([`${prefix}._parentcustomerid_value`, `${prefix}.fullname`]);
      const linkName = prefix === 'pc' ? 'pc' : 'contact';
      expect(labels(result).slice(-2)).toEqual([`${linkName}.parentcustomerid`, `${linkName}.fullname`]);
      expect(values(result, 0).slice(-2)).toEqual(['', 'Name']);
      expect(values(result, 1).slice(-2)).toEqual(['c-1', '']);
    }));
  }

  it('puts the block of all primary columns before the columns of the links', fakeAsync(() => {
    const result = shape(
      query('<link-entity name="contact" from="a" to="b" alias="pc"><attribute name="fullname" alias="a_who" /></link-entity>'),
      [{ a_who: 'Name', accountid: 'a-1', name: 'A' }]);

    expect(keys(result)).toEqual(['accountid', 'industrycode', 'name', 'ownerid', 'a_who']);
  }));

  it('maps a primary lookup that has no metadata', fakeAsync(() => {
    const result = shape(query('<attribute name="ownerid" />'), [{ _ownerid_value: 'u-1' }], new Map());

    expect(keys(result)).toEqual(['_ownerid_value']);
    expect(labels(result)).toEqual(['ownerid']);
    expect(values(result)).toEqual(['u-1']);
  }));

  it('labels each column of an attribute requested twice with its own alias', fakeAsync(() => {
    const result = shape(
      query('<attribute name="name" alias="first" /><attribute name="name" alias="second" />'),
      [{ first: 'A', second: 'A' }]);

    expect(labels(result)).toEqual(['first', 'second']);
    expect(Object.values(result.header).map(column => column.logicalName)).toEqual(['first', 'second']);
  }));

  it('shows what it cannot map under the original name, last, without annotations', fakeAsync(() => {
    const result = shape(query('<attribute name="name" />'), [
      { '@odata.etag': 'W/"1"', 'name': 'A' },
      {
        '@odata.etag': 'W/"2"', 'name': 'B', 'AccountId': 'x',
        'other.thing': 1, 'other.thing@OData.Community.Display.V1.FormattedValue': '1.00'
      }
    ]);

    expect(keys(result)).toEqual(['name', 'AccountId', 'other.thing']);
    expect(labels(result)).toEqual(['Account Name', 'AccountId', 'other.thing']);
    expect(values(result, 1)).toEqual(['B', 'x', 1]);
    expect(result.rows[1].attributes.get('other.thing').attributeFormattedValue).toBe('1.00');
  }));

  it('shows aggregate columns in query order without record links', fakeAsync(() => {
    const result = shape(aggregate.xml, aggregate.rows);

    expect(keys(result)).toEqual(['AccountCount', 'Employees', 'Owner', 'Industry']);
    expect(labels(result)).toEqual(['AccountCount', 'Employees', 'Owner', 'Industry']);
    expect(values(result, 1)).toEqual([1, 0, '00000000-0000-0000-0000-0000000000b1', '']);
    expect(result.rows.map(row => row.dataverseRowLink)).toEqual(['', '']);
    expect(result.rows[0].attributes.get('Owner').link).toContain('etn=systemuser');
  }));

  it('has no record link when an aggregate alias is the name of the primary id', fakeAsync(() => {
    const result = shape(
      '<fetch aggregate="true"><entity name="account"><attribute name="name" alias="accountid" aggregate="count" /></entity></fetch>',
      [{ accountid: 3 }]);

    expect(result.rows[0].dataverseRowLink).toBe('');
  }));

  it('has no record link for distinct rows', fakeAsync(() => {
    const result = shape('<fetch distinct="true"><entity name="account"><attribute name="name" /></entity></fetch>', [{ name: 'A' }]);

    expect(result.rows[0].dataverseRowLink).toBe('');
  }));

  it('links a row by an aliased primary id', fakeAsync(() => {
    const result = shape(query('<attribute name="accountid" alias="id" />'), [{ id: 'a-1' }]);

    expect(result.rows[0].dataverseRowLink).toContain('id=a-1');
  }));
});
