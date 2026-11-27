import { Inject, Injectable } from '@angular/core';
import { Observable, Subject, of, defer, switchMap, catchError, BehaviorSubject, map, startWith, take, throwIfEmpty, filter, merge } from 'rxjs';
import { BaseRequestService } from './entity-services/abstract/base-request.service';
import { API_ENDPOINTS } from 'src/app/config/api-endpoints';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { NodeTreeService } from './node-tree.service';
import { AttributeEntityService } from './entity-services/attribute-entity.service';
import { QueryNode } from '../models/query-node';
import { ErrorDialogService } from 'src/app/services/error-dialog.service';
import { AllAttributesStrategy, RowData } from './result-table/all-attributes-strategy';
import { DefinedAttributesStrategy } from './result-table/defined-attributes-strategy';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { MAX_REQUEST_URL_LENGTH, getPageableQueryPage, readPagingCookie, sanitizeForTransmission, withFirstPage, withPage } from './fetch-xml-request';
import { RequestNotSentError } from 'src/app/models/request-not-sent-error';

interface FetchXmlQueryOptions {
  maxPageSize?: number;
  includeAnnotations?: boolean;
  timeout?: number;
  includeFieldTypes?: boolean;
  includeLinkedEntities?: boolean;
}

export interface FieldTypeInfo {
  value: any;
  type: string;
  displayName?: string;
  FormattedValue?: string;
  associatednavigationproperty?: string;
  lookuplogicalname?: string;
  entityLogicalName?: string;
  [key: string]: any; // For any additional annotations
}

export interface TypedResultItem {
  [key: string]: any | FieldTypeInfo;
}

export interface HeaderMetadata {
  displayName: string;
  logicalName: string;
  type: string;
}

export interface MatTableRawData {
  header: { [key: string]: HeaderMetadata };
  rows: RowData[];
  __original_data?: any[];
}

export interface XmlExecutionResult {
  header: { [key: string]: HeaderMetadata };
  rawValues: any[];
  formattedValues: any[];
  linkValues?: any[]; // Add support for link values used by the result table
  __original_data?: any[]; // Original data from the API response for reference
}

type EntityAttributeMapping = ReturnType<NodeTreeService['getEntityAttributeMap']>;

/** What is needed to request the next page and to shape it like the pages before it. */
export interface QueryContinuation {
  /** The FetchXML of the first request */
  readonly xml: string;
  readonly entitySetName: string;
  /** The environment of the first page; no page is requested from any other one */
  readonly environmentUrl: string;
  /** Read from the query tree for the first page: the tree may have been edited since */
  readonly entityAttributeMap: EntityAttributeMapping;
  readonly primaryEntityName: string;
  readonly nextPage: number;
  readonly pagingCookie: string | null;
  /** The rows of all received pages */
  readonly receivedRows: any[];
}

export interface RowsState {
  status: 'rows';
  result: MatTableRawData;
  /** The same for all states of one execution, so that loaded pages can be told from a new result */
  executionId?: number;
  /** Set while Dataverse has more rows than were received */
  continuation?: QueryContinuation;
  isLoadingMore?: boolean;
  /** The last attempt to load more rows failed; the rows received before it are kept */
  loadMoreError?: { message: string; code?: string };
}

/** The single state of the latest query execution; the result table renders from it. */
export type ExecutionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | RowsState
  | { status: 'empty' }
  | { status: 'requestError'; message: string; code?: string }
  | { status: 'processingError'; message: string };

type ExecutionRequest =
  | { kind: 'execute'; xml: string; entityNode: QueryNode }
  | { kind: 'loadMore'; rows: RowsState };

// Define an interface for the Dataverse response
interface DataverseExecuteXmlResponse {
  statusCode?: number;
  headers?: any;
  body?: {
    value: any[];
    'odata.metadata'?: string;
    'odata.nextLink'?: string;
  };
  // Add direct properties to support both response formats
  value?: any[];
  '@odata.context'?: string;
  '@Microsoft.Dynamics.CRM.totalrecordcount'?: number;
  '@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded'?: boolean;
  '@Microsoft.Dynamics.CRM.globalmetadataversion'?: string;
  '@Microsoft.Dynamics.CRM.morerecords'?: boolean;
  '@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'?: string;
}

@Injectable({ providedIn: 'root' })
export class XmlExecutorService extends BaseRequestService {
  private rawDataverseResultSubject = new BehaviorSubject<DataverseExecuteXmlResponse>(null);

  private readonly executionRequests$ = new Subject<ExecutionRequest>();
  private readonly executionState = new BehaviorSubject<ExecutionState>({ status: 'idle' });
  public readonly state$: Observable<ExecutionState> = this.executionState.asObservable();
  private lastExecutionId = 0;

  constructor(
    private attributeEntityService: AttributeEntityService,
    private nodeTreeService: NodeTreeService,
    private errorDialogService: ErrorDialogService,
    @Inject(ACTIVE_ENVIRONMENT_MODEL) private _activeEnvironmentModel: BehaviorSubject<EnvironmentModel>
  ) {
    super();
    // switchMap: a new execution cancels whatever the previous one still has in flight
    this.executionRequests$
      .pipe(switchMap(request => request.kind === 'execute'
        ? this.runExecution(request.xml, request.entityNode)
        : this.runLoadMore(request.rows)))
      .subscribe(state => this.executionState.next(state));
  }

  getRawDataverseRawResult(): BehaviorSubject<DataverseExecuteXmlResponse> {
    return this.rawDataverseResultSubject;
  }

  /** Starts a query execution. The outcome is published on state$. */
  execute(xml: string, entityNode: QueryNode): void {
    this.executionRequests$.next({ kind: 'execute', xml, entityNode });
  }

  /**
   * Requests the next page of the shown result and appends its rows. Does nothing when there is no
   * next page, a page is already on its way or another environment is active.
   */
  loadMore(): void {
    const state = this.executionState.value;

    if (state.status !== 'rows' || !state.continuation || state.isLoadingMore
      || this._activeEnvironmentModel.value?.url !== state.continuation.environmentUrl) {
      return;
    }

    this.executionRequests$.next({ kind: 'loadMore', rows: state });
  }

  /** Emits 'loading' and then one final state. Never errors, so the pipeline stays alive. */
  private runExecution(xml: string, entityNode: QueryNode): Observable<ExecutionState> {
    const executionId = ++this.lastExecutionId;

    return defer(() => {
      // Read once: a later environment change must not re-send this query
      const environmentUrl = this._activeEnvironmentModel.value?.url;

      if (!xml || !entityNode) {
        throw new Error('XML and entity information are required. Please ensure you have a valid query with entity information before executing');
      }

      const entitySetName: string = entityNode.entitySetName$?.value;
      // only the request gets the page attribute, the query in the editor stays as it is
      const sentXml = withFirstPage(sanitizeForTransmission(xml));

      return this.executeRequest(sentXml, entitySetName, environmentUrl).pipe(
        switchMap(response => {
          this.rawDataverseResultSubject.next({ ...response });
          const data = response?.value || [];

          if (!data.length) {
            return of<ExecutionState>({ status: 'empty' });
          }

          // read inside defer, so that a broken query tree is a processing error
          let entityAttributeMap: EntityAttributeMapping;
          let primaryEntityName: string;

          return defer(() => {
            entityAttributeMap = this.nodeTreeService.getEntityAttributeMap();
            primaryEntityName = this.nodeTreeService.getPrimaryEntityName();
            return this.processRows(data, entityAttributeMap, primaryEntityName, environmentUrl);
          }).pipe(
            map((result): ExecutionState => ({
              status: 'rows',
              result,
              executionId,
              continuation: this.buildContinuation(response, getPageableQueryPage(sentXml), {
                xml: sentXml, entitySetName, environmentUrl, entityAttributeMap, primaryEntityName, receivedRows: data
              })
            })),
            catchError(error => of(this.reportProcessingError(error, data.length)))
          );
        })
      );
    }).pipe(
      catchError(error => of(this.reportRequestError(error, entityNode?.entitySetName$?.value))),
      startWith<ExecutionState>({ status: 'loading' })
    );
  }

  /**
   * Emits the shown rows marked as loading and then the rows with the next page appended. A change
   * of the environment cancels the request and leaves the rows as they were.
   */
  private runLoadMore(shown: RowsState): Observable<ExecutionState> {
    const previous: RowsState = { ...shown, isLoadingMore: false, loadMoreError: undefined };
    const { continuation } = previous;

    const nextRows$ = defer(() => this.executeRequest(
      withPage(continuation.xml, continuation.nextPage, continuation.pagingCookie),
      continuation.entitySetName,
      continuation.environmentUrl
    )).pipe(
      switchMap(response => this.appendPage(previous, response)),
      catchError(error => {
        const { message, code } = this.reportRequestError(error, continuation.entitySetName);
        return of<ExecutionState>({ ...previous, loadMoreError: { message, code } });
      })
    );

    const environmentChanged$ = this._activeEnvironmentModel.pipe(
      filter(environment => environment?.url !== continuation.environmentUrl),
      map((): ExecutionState => previous)
    );

    return merge(environmentChanged$, nextRows$).pipe(
      take(1),
      startWith<ExecutionState>({ ...previous, isLoadingMore: true })
    );
  }

  /** Shapes all received rows together, the way one response of that size would be shaped. */
  private appendPage(previous: RowsState, response: DataverseExecuteXmlResponse): Observable<ExecutionState> {
    const { continuation } = previous;
    const page = response?.value || [];

    if (!page.length) {
      return of<ExecutionState>({ ...previous, continuation: undefined });
    }

    const receivedRows = continuation.receivedRows.concat(page);

    return this.processRows(receivedRows, continuation.entityAttributeMap, continuation.primaryEntityName, continuation.environmentUrl).pipe(
      map((result): ExecutionState => {
        // The raw result panel shows one response holding the rows of all pages
        this.rawDataverseResultSubject.next({ ...response, value: receivedRows });

        return {
          ...previous,
          result,
          continuation: this.buildContinuation(response, continuation.nextPage, { ...continuation, receivedRows })
        };
      }),
      catchError(error => {
        const { message } = this.reportProcessingError(error, page.length);
        return of<ExecutionState>({ ...previous, loadMoreError: { message } });
      })
    );
  }

  /** Undefined when there is nothing more to load. */
  private buildContinuation(
    response: DataverseExecuteXmlResponse,
    receivedPage: number | null,
    query: Omit<QueryContinuation, 'nextPage' | 'pagingCookie'>
  ): QueryContinuation | undefined {
    if (receivedPage === null || !response['@Microsoft.Dynamics.CRM.morerecords']) {
      return undefined;
    }

    return {
      ...query,
      nextPage: receivedPage + 1,
      pagingCookie: readPagingCookie(response['@Microsoft.Dynamics.CRM.fetchxmlpagingcookie'])
    };
  }

  private processRows(
    data: any[],
    entityAttributeMap: EntityAttributeMapping,
    primaryEntityName: string,
    environmentUrl: string
  ): Observable<MatTableRawData> {
    return defer(() => this.processDataWithStrategy(data, entityAttributeMap, primaryEntityName, environmentUrl)).pipe(
      // The metadata stream behind a strategy stays open and follows environment changes
      take(1),
      throwIfEmpty(() => new Error('The result strategy completed without a result')),
      map(result => {
        // The strategies swallow their own exceptions and return no rows instead
        if (!result.rows?.length) {
          throw new Error(`The result strategy returned no rows for ${data.length} received rows`);
        }
        return result;
      })
    );
  }

  private reportProcessingError(error: any, rowCount: number) {
    console.error('Error processing the query result:', error);
    return {
      status: 'processingError' as const,
      message: `Rows were received (${rowCount}) but could not be displayed`
    };
  }

  private reportRequestError(error: any, entitySetName: string) {
    // The message of an HTTP error holds the URL, and the URL holds the query and the paging cookie
    // with values of records: neither is logged
    const logged = error instanceof HttpErrorResponse
      ? `GET ${entitySetName} failed with status ${error.status}`
      : error?.message || 'Unknown error';
    console.error('Error executing XML request:', logged);

    const dataverseError = error?.error?.error;
    const message: string = dataverseError?.message || error?.message || 'Unknown error';

    if (error instanceof RequestNotSentError && error.signInRequired) {
      // The sign-in prompt is already on screen; a second dialog would cover it
    } else if (dataverseError?.message) {
      this.errorDialogService.showHttpError(error);
    } else {
      // No Dataverse body (network failure, missing environment): keep the original text
      this.errorDialogService.showError({
        title: 'Query Execution Error',
        message: 'An error occurred while executing the query',
        details: message
      });
    }

    const code: string = dataverseError?.code;
    return { status: 'requestError' as const, message, code };
  }

  private extractQueryOptions(): FetchXmlQueryOptions {
    try {
      const options: FetchXmlQueryOptions = {};

      const fetchNode = this.nodeTreeService.getNodeTree().value.root;
      if (!fetchNode) {
        return options;
      }

      const topAttribute = fetchNode.attributes$.value.find(attr => attr.editorName === 'top');
      if (topAttribute?.value$.value) {
        options.maxPageSize = parseInt(topAttribute.value$.value, 10);
      }

      const hasAnnotations = this.nodeTreeService.getNodeTree().value.root.attributes$.value
        .some(attr => attr.editorName === 'name' && attr.value$.value?.includes('annotation'));

      if (hasAnnotations) {
        options.includeAnnotations = true;
      }
      return options;
    } catch (error) { throw error; }
  }

  private executeRequest(xml: string, entitySetName: string, environmentUrl: string): Observable<DataverseExecuteXmlResponse> {
    if (!entitySetName) {
      throw new Error('Entity name is missing or invalid. Please select a valid entity for your query');
    }

    if (!environmentUrl) {
      throw new Error('No active environment URL found. Please connect to an environment before executing the query');
    }

    const url = API_ENDPOINTS.execute.getResourceUrl(environmentUrl, entitySetName, encodeURIComponent(xml));
    // measured as sent: the browser escapes some characters that encodeURIComponent leaves as they are
    const urlLength = new URL(url).href.length;

    if (urlLength > MAX_REQUEST_URL_LENGTH) {
      throw new Error(`The query is too long to send: the request URL has ${urlLength} characters, Dataverse accepts up to ${MAX_REQUEST_URL_LENGTH}. Shorten the query, for example the list of values of an "in" condition`);
    }

    const headers = this.buildRequestOptions(this.extractQueryOptions());

    return this.httpClient.get<DataverseExecuteXmlResponse>(url, headers);
  }

  private buildRequestOptions(options: FetchXmlQueryOptions): { headers: HttpHeaders } {
    const preferOptions = [];

    // Add annotations option
    if (options.includeAnnotations) {
      preferOptions.push('odata.include-annotations="*"');
    } else {
      // Include annotations by default for backward compatibility
      preferOptions.push('odata.include-annotations="*"');
    }
    // Construct headers
    const headers = new HttpHeaders({
      'Prefer': preferOptions.join(',')
    });

    return { headers };
  }

  private processDataWithStrategy(
    data: any[],
    entityAttributeMap: EntityAttributeMapping,
    primaryEntityName: string,
    environmentUrl: string
  ): Observable<MatTableRawData> {
    if (!entityAttributeMap || !primaryEntityName) {
      throw new Error('The query tree has no primary entity to map the result columns to');
    }

    const hasDefinedAttributes = Object.values(entityAttributeMap)
      .some(entityData => entityData.attributeData?.length > 0);

    const strategy = hasDefinedAttributes
      ? new DefinedAttributesStrategy(this.attributeEntityService)
      : new AllAttributesStrategy(this.attributeEntityService);

    return strategy.processRawData(data, entityAttributeMap, primaryEntityName, environmentUrl);
  }
}
