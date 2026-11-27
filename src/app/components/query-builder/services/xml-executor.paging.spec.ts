import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { QueryNode } from '../models/query-node';
import { provideQueryBuilderTesting } from './query-builder-test-providers';
import { NodeTreeService } from './node-tree.service';
import { ExecutionState, RowsState, XmlExecutorService } from './xml-executor.service';

describe('XmlExecutorService paging and request limits', () => {
  const XML = '<fetch>\n  <entity name="account" />\n</fetch>';
  const entityNode = { entitySetName$: new BehaviorSubject('accounts') } as unknown as QueryNode;
  const metadata = {
    value: [{ LogicalName: 'name', DisplayName: { UserLocalizedLabel: { Label: 'Account Name' } }, AttributeType: 'String' }]
  };
  // the shape of the annotation in the Dataverse documentation: the cookie is URL-encoded twice
  const cookie = '<cookie page="1"><name last="B &amp; B" first="A  A" /></cookie>';
  const annotation = `<cookie pagenumber="2" pagingcookie="${encodeURIComponent(encodeURIComponent(cookie))}" istracking="False" />`;
  const moreRows = (...names: string[]) => ({
    value: names.map(name => ({ name })),
    '@Microsoft.Dynamics.CRM.morerecords': true,
    '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie': annotation
  });

  let service: XmlExecutorService;
  let http: HttpTestingController;
  let environment$: BehaviorSubject<EnvironmentModel>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let states: ExecutionState[];

  const environment = (host: string) => ({ url: `https://${host}.example.com` }) as EnvironmentModel;
  const isExecute = (url: string) => url.includes('?fetchXml=');
  const executeRequest = (): TestRequest => http.expectOne(request => isExecute(request.url));
  const sentXml = (request: TestRequest) => decodeURIComponent(request.request.url.split('?fetchXml=')[1]);
  const sentFetch = (request: TestRequest) => new DOMParser().parseFromString(sentXml(request), 'text/xml').documentElement;
  const tick = () => new Promise(resolve => setTimeout(resolve));
  // metadata is requested once and cached afterwards
  const settle = async () => {
    http.match(request => request.url.includes('/Attributes?')).forEach(r => r.flush(metadata));
    await tick();
  };
  const lastState = () => states[states.length - 1];
  const rowsState = () => lastState() as RowsState;
  const names = () => rowsState().result.rows.map(row => row.attributes.get('name').attributeRawValue);

  const executeWith = async (response: object, xml = XML) => {
    service.execute(xml, entityNode);
    executeRequest().flush(response);
    await settle();
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    TestBed.configureTestingModule({
      providers: [...provideQueryBuilderTesting(), { provide: MatDialog, useValue: dialog }]
    });

    const nodeTree = TestBed.inject(NodeTreeService);
    spyOn(nodeTree, 'getEntityAttributeMap').and.returnValue(
      { account: { entityAlias: null, attributeData: [], isPrimaryEntity: true } });
    spyOn(nodeTree, 'getPrimaryEntityName').and.returnValue('account');

    environment$ = TestBed.inject(ACTIVE_ENVIRONMENT_MODEL);
    environment$.next(environment('first'));
    service = TestBed.inject(XmlExecutorService);
    http = TestBed.inject(HttpTestingController);

    states = [];
    service.state$.subscribe(state => states.push(state));
    spyOn(console, 'error');
  });

  it('marks a response with more records as incomplete', async () => {
    await executeWith(moreRows('A'));

    expect(rowsState().status).toBe('rows');
    expect(rowsState().continuation).toEqual(jasmine.objectContaining({ nextPage: 2, pagingCookie: cookie }));
  });

  it('has nothing more to load without the annotation', async () => {
    await executeWith({ value: [{ name: 'A' }] });

    expect(rowsState().continuation).toBeUndefined();
    service.loadMore();
    http.expectNone(request => isExecute(request.url));
  });

  for (const attribute of ['top="10"', 'aggregate="true"']) {
    it(`does not page a query with ${attribute}`, async () => {
      await executeWith(moreRows('A'), `<fetch ${attribute}><entity name="account" /></fetch>`);

      expect(rowsState().continuation).toBeUndefined();
    });
  }

  it('requests the next page with the decoded cookie and appends its rows', async () => {
    await executeWith(moreRows('A', 'B'));
    const executionId = rowsState().executionId;

    service.loadMore();
    expect(rowsState().isLoadingMore).toBeTrue();
    expect(names()).toEqual(['A', 'B']);

    const second = executeRequest();
    expect(second.request.url).toContain('https://first.example.com/');
    expect(sentFetch(second).getAttribute('page')).toBe('2');
    expect(sentFetch(second).getAttribute('paging-cookie')).toBe(cookie);

    second.flush(moreRows('C'));
    await settle();

    expect(names()).toEqual(['A', 'B', 'C']);
    expect(rowsState().executionId).toBe(executionId);
    expect(rowsState().isLoadingMore).toBeFalse();
    expect(service.getRawDataverseRawResult().value.value).toEqual([{ name: 'A' }, { name: 'B' }, { name: 'C' }]);

    service.loadMore();
    const third = executeRequest();
    expect(sentFetch(third).getAttribute('page')).toBe('3');
    third.flush({ value: [{ name: 'D' }] });
    await settle();

    expect(names()).toEqual(['A', 'B', 'C', 'D']);
    expect(rowsState().continuation).toBeUndefined();
  });

  it('pages without a cookie when Dataverse returns none', async () => {
    await executeWith({ value: [{ name: 'A' }], '@Microsoft.Dynamics.CRM.morerecords': true });

    service.loadMore();
    const second = executeRequest();

    expect(sentFetch(second).getAttribute('page')).toBe('2');
    expect(sentFetch(second).hasAttribute('paging-cookie')).toBeFalse();
  });

  it('sends one request when load more is called twice', async () => {
    await executeWith(moreRows('A'));

    service.loadMore();
    service.loadMore();

    expect(http.match(request => isExecute(request.url)).length).toBe(1);
  });

  it('cancels loading more when a new execution starts', async () => {
    await executeWith(moreRows('A'));
    service.loadMore();
    const nextPage = executeRequest();

    await executeWith({ value: [{ name: 'Z' }] });

    expect(nextPage.cancelled).toBeTrue();
    expect(names()).toEqual(['Z']);
  });

  it('cancels loading more on an environment change and loads only from the first environment', async () => {
    await executeWith(moreRows('A'));
    service.loadMore();
    const nextPage = executeRequest();

    environment$.next(environment('second'));

    expect(nextPage.cancelled).toBeTrue();
    expect(rowsState().isLoadingMore).toBeFalse();
    expect(names()).toEqual(['A']);

    service.loadMore();
    http.expectNone(() => true);

    environment$.next(environment('first'));
    service.loadMore();
    expect(executeRequest().request.url).toContain('https://first.example.com/');
  });

  it('keeps the shown rows when loading more fails, and can retry', async () => {
    await executeWith(moreRows('A'));
    service.loadMore();
    executeRequest().flush({ error: { code: '0x1', message: 'Throttled' } }, { status: 429, statusText: 'Too Many Requests' });

    expect(names()).toEqual(['A']);
    expect(rowsState().loadMoreError).toEqual({ message: 'Throttled', code: '0x1' });
    expect(dialog.open).toHaveBeenCalledTimes(1);

    service.loadMore();
    expect(rowsState().loadMoreError).toBeUndefined();
    executeRequest().flush({ value: [{ name: 'B' }] });
    await settle();

    expect(names()).toEqual(['A', 'B']);
  });

  it('does not send a query that is too long', () => {
    const values = '<value>00000000-0000-0000-0000-000000000000</value>'.repeat(700);
    service.execute(`<fetch><entity name="account"><filter><condition attribute="accountid" operator="in">${values}</condition></filter></entity></fetch>`, entityNode);

    http.expectNone(() => true);
    expect(lastState()).toEqual(jasmine.objectContaining({ status: 'requestError', message: jasmine.stringContaining('too long') }));
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('sends whitespace inside values unchanged', () => {
    service.execute(
      '<fetch>\n  <!-- note -->\n  <entity name="account">\n    <filter>\n      <condition attribute="name" operator="eq" value="A  B" />\n      <condition attribute="name" operator="in">\n        <value>C  D</value>\n      </condition>\n    </filter>\n  </entity>\n</fetch>',
      entityNode);

    expect(sentXml(executeRequest())).toBe(
      '<fetch> <entity name="account"> <filter> <condition attribute="name" operator="eq" value="A  B" /> <condition attribute="name" operator="in"> <value>C  D</value> </condition> </filter> </entity> </fetch>');
  });
});
