import { Inject, Injectable } from '@angular/core';
import { Observable, Subject, of, defer, switchMap, catchError, BehaviorSubject, map, startWith, take, throwIfEmpty } from 'rxjs';
import { BaseRequestService } from './entity-services/abstract/base-request.service';
import { API_ENDPOINTS } from 'src/app/config/api-endpoints';
import { HttpHeaders } from '@angular/common/http';
import { NodeTreeService } from './node-tree.service';
import { AttributeEntityService } from './entity-services/attribute-entity.service';
import { QueryNode } from '../models/query-node';
import { ErrorDialogService } from 'src/app/services/error-dialog.service';
import { AllAttributesStrategy, RowData } from './result-table/all-attributes-strategy';
import { DefinedAttributesStrategy } from './result-table/defined-attributes-strategy';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EnvironmentModel } from 'src/app/models/environment-model';
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

/** The single state of the latest query execution; the result table renders from it. */
export type ExecutionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'rows'; result: MatTableRawData }
  | { status: 'empty' }
  | { status: 'requestError'; message: string; code?: string }
  | { status: 'processingError'; message: string };

interface ExecutionRequest {
  xml: string;
  entityNode: QueryNode;
}

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
}

@Injectable({ providedIn: 'root' })
export class XmlExecutorService extends BaseRequestService {
  private rawDataverseResultSubject = new BehaviorSubject<DataverseExecuteXmlResponse>(null);

  private readonly executionRequests$ = new Subject<ExecutionRequest>();
  private readonly executionState = new BehaviorSubject<ExecutionState>({ status: 'idle' });
  public readonly state$: Observable<ExecutionState> = this.executionState.asObservable();

  constructor(
    private attributeEntityService: AttributeEntityService,
    private nodeTreeService: NodeTreeService,
    private errorDialogService: ErrorDialogService,
    @Inject(ACTIVE_ENVIRONMENT_MODEL) private _activeEnvironmentModel: BehaviorSubject<EnvironmentModel>
  ) {
    super();
    // switchMap: a new execution cancels whatever the previous one still has in flight
    this.executionRequests$
      .pipe(switchMap(request => this.runExecution(request)))
      .subscribe(state => this.executionState.next(state));
  }

  getRawDataverseRawResult(): BehaviorSubject<DataverseExecuteXmlResponse> {
    return this.rawDataverseResultSubject;
  }

  /** Starts a query execution. The outcome is published on state$. */
  execute(xml: string, entityNode: QueryNode): void {
    this.executionRequests$.next({ xml, entityNode });
  }

  /** Emits 'loading' and then one final state. Never errors, so the pipeline stays alive. */
  private runExecution({ xml, entityNode }: ExecutionRequest): Observable<ExecutionState> {
    return defer(() => {
      // Read once: a later environment change must not re-send this query
      const environmentUrl = this._activeEnvironmentModel.value?.url;

      return this.executeRequest(xml, entityNode, environmentUrl).pipe(
        switchMap(response => {
          this.rawDataverseResultSubject.next({ ...response });
          return this.toResultState(response?.value || [], environmentUrl);
        })
      );
    }).pipe(
      catchError(error => of(this.reportRequestError(error))),
      startWith<ExecutionState>({ status: 'loading' })
    );
  }

  private toResultState(data: any[], environmentUrl: string): Observable<ExecutionState> {
    if (!data.length) {
      return of<ExecutionState>({ status: 'empty' });
    }

    return defer(() => this.processDataWithStrategy(data, environmentUrl)).pipe(
      // The metadata stream behind a strategy stays open and follows environment changes
      take(1),
      throwIfEmpty(() => new Error('The result strategy completed without a result')),
      map((result): ExecutionState => {
        // The strategies swallow their own exceptions and return no rows instead
        if (!result.rows?.length) {
          throw new Error(`The result strategy returned no rows for ${data.length} received rows`);
        }
        return { status: 'rows', result };
      }),
      catchError(error => {
        console.error('Error processing the query result:', error);
        return of<ExecutionState>({
          status: 'processingError',
          message: `Rows were received (${data.length}) but could not be displayed`
        });
      })
    );
  }

  private reportRequestError(error: any): ExecutionState {
    console.error('Error executing XML request:', error?.message || 'Unknown error');

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

    return { status: 'requestError', message, code: dataverseError?.code };
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

  private sanitizeForTransmission(xml: string): string {
    return xml
      .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  private executeRequest(xml: string, entityNode: QueryNode, environmentUrl: string): Observable<DataverseExecuteXmlResponse> {
    if (!xml || !entityNode) {
      throw new Error('XML and entity information are required. Please ensure you have a valid query with entity information before executing');
    }

    const entitySetName = entityNode.entitySetName$?.value;
    if (!entitySetName) {
      throw new Error('Entity name is missing or invalid. Please select a valid entity for your query');
    }

    if (!environmentUrl) {
      throw new Error('No active environment URL found. Please connect to an environment before executing the query');
    }

    const sanitizedXml = this.sanitizeForTransmission(xml);
    const encodedXml = encodeURIComponent(sanitizedXml);
    const url = API_ENDPOINTS.execute.getResourceUrl(environmentUrl, entitySetName, encodedXml);
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

  private processDataWithStrategy(data: any[], environmentUrl: string): Observable<MatTableRawData> {
    const entityAttributeMap = this.nodeTreeService.getEntityAttributeMap();
    const primaryEntityName = this.nodeTreeService.getPrimaryEntityName();

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
