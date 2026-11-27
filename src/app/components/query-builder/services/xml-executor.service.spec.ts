import { TestBed } from '@angular/core/testing';
import { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { QueryNode } from '../models/query-node';
import { provideQueryBuilderTesting } from './query-builder-test-providers';
import { EntityAttributeMap } from './entity-services/attribute-entity.service';
import { NodeTreeService } from './node-tree.service';
import { AllAttributesStrategy } from './result-table/all-attributes-strategy';
import { ExecutionState, XmlExecutorService } from './xml-executor.service';

describe('XmlExecutorService execution pipeline', () => {
  const XML = '<fetch><entity name="account" /></fetch>';
  const entityNode = { entitySetName$: new BehaviorSubject('accounts') } as unknown as QueryNode;
  const metadata = {
    value: [{ LogicalName: 'name', DisplayName: { UserLocalizedLabel: { Label: 'Account Name' } }, AttributeType: 'String' }]
  };

  let service: XmlExecutorService;
  let http: HttpTestingController;
  let environment$: BehaviorSubject<EnvironmentModel>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let entityMap: jasmine.Spy<() => EntityAttributeMap>;
  let states: ExecutionState[];

  const allAttributes: EntityAttributeMap = { account: { entityAlias: null, attributeData: [], isPrimaryEntity: true } };
  const definedAttributes: EntityAttributeMap = {
    account: { entityAlias: null, attributeData: [{ attributeLogicalName: 'name', alias: null }], isPrimaryEntity: true }
  };

  const environment = (host: string) => ({ url: `https://${host}.example.com` }) as EnvironmentModel;
  const executeRequests = () => http.match(request => request.url.includes('?fetchXml='));
  const executeRequest = (): TestRequest => http.expectOne(request => request.url.includes('?fetchXml='));
  // the all-attributes strategy resolves through a Promise, hence the tick
  const flushMetadata = () => {
    http.match(request => request.url.includes('/Attributes?')).forEach(r => r.flush(metadata));
    return new Promise(resolve => setTimeout(resolve));
  };
  const lastState = () => states[states.length - 1];

  beforeEach(() => {
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    TestBed.configureTestingModule({
      providers: [...provideQueryBuilderTesting(), { provide: MatDialog, useValue: dialog }]
    });

    const nodeTree = TestBed.inject(NodeTreeService);
    entityMap = spyOn(nodeTree, 'getEntityAttributeMap').and.returnValue(allAttributes);
    spyOn(nodeTree, 'getPrimaryEntityName').and.returnValue('account');

    environment$ = TestBed.inject(ACTIVE_ENVIRONMENT_MODEL);
    environment$.next(environment('first'));
    service = TestBed.inject(XmlExecutorService);
    http = TestBed.inject(HttpTestingController);

    states = [];
    service.state$.subscribe(state => states.push(state));
    spyOn(console, 'error');
  });

  it('cancels the first request when a second execution starts', () => {
    service.execute(XML, entityNode);
    const first = executeRequest();

    service.execute(XML, entityNode);
    const second = executeRequest();

    expect(first.cancelled).toBeTrue();
    expect(second.cancelled).toBeFalse();

    second.flush({ value: [] });
    expect(states.map(s => s.status)).toEqual(['idle', 'loading', 'loading', 'empty']);
  });

  for (const [name, map] of [['all attributes', allAttributes], ['defined attributes', definedAttributes]] as const) {
    it(`sends nothing when the environment changes after a completed execution (${name})`, async () => {
      entityMap.and.returnValue(map);
      service.execute(XML, entityNode);
      executeRequest().flush({ value: [{ name: 'Contoso', accountid: '1' }] });
      await flushMetadata();
      expect(lastState().status).toBe('rows');

      environment$.next(environment('second'));

      expect(http.match(() => true).length).toBe(0);
    });
  }

  it('turns a 400 with a Dataverse body into a request error and opens one dialog', () => {
    service.execute(XML, entityNode);
    executeRequest().flush(
      { error: { code: '0x80041103', message: "'account' entity doesn't contain attribute with Name = 'nmae'." } },
      { status: 400, statusText: 'Bad Request' });

    expect(lastState()).toEqual({
      status: 'requestError',
      message: "'account' entity doesn't contain attribute with Name = 'nmae'.",
      code: '0x80041103'
    });
    expect(dialog.open).toHaveBeenCalledTimes(1);
    expect(dialog.open.calls.mostRecent().args[1].data).toEqual(jasmine.objectContaining({
      message: "'account' entity doesn't contain attribute with Name = 'nmae'.",
      details: 'Error code: 0x80041103'
    }));

    // the pipeline survives an error
    service.execute(XML, entityNode);
    executeRequest().flush({ value: [] });
    expect(lastState().status).toBe('empty');
  });

  it('reports a request error without sending anything when no environment is active', () => {
    environment$.next(null);

    service.execute(XML, entityNode);

    expect(executeRequests().length).toBe(0);
    expect(lastState().status).toBe('requestError');
    expect(dialog.open).toHaveBeenCalledTimes(1);
  });

  it('reports a processing error, not empty, when a strategy throws', () => {
    const failure = new Error('boom');
    spyOn(AllAttributesStrategy.prototype, 'processRawData').and.throwError(failure);

    service.execute(XML, entityNode);
    executeRequest().flush({ value: [{ name: 'Contoso' }] });

    expect(lastState()).toEqual({ status: 'processingError', message: 'Rows were received (1) but could not be displayed' });
    expect(console.error).toHaveBeenCalledWith('Error processing the query result:', failure);
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('reports a processing error when a strategy swallows its exception and returns no rows', async () => {
    // no attributeData: the defined-attributes strategy throws inside and catches it itself
    entityMap.and.returnValue({
      account: { entityAlias: null, attributeData: [{ attributeLogicalName: 'name', alias: null }], isPrimaryEntity: false }
    });

    service.execute(XML, entityNode);
    executeRequest().flush({ value: [{ name: 'Contoso' }] });
    await flushMetadata();

    expect(lastState().status).toBe('processingError');
  });

  it('turns an empty value into the empty state, with no previous rows left', async () => {
    service.execute(XML, entityNode);
    executeRequest().flush({ value: [{ name: 'Contoso' }] });
    await flushMetadata();
    expect(lastState().status).toBe('rows');

    service.execute(XML, entityNode);
    executeRequest().flush({ value: [] });

    expect(lastState()).toEqual({ status: 'empty' });
  });
});
