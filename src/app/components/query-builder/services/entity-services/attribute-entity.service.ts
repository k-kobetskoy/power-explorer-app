import { Injectable } from '@angular/core';
import { Observable, of, switchMap, map, catchError, tap, shareReplay, finalize, BehaviorSubject } from 'rxjs';
import { API_ENDPOINTS } from 'src/app/config/api-endpoints';
import { AttributeModel } from 'src/app/models/incoming/attrubute/attribute-model';
import { AttributeResponseModel } from 'src/app/models/incoming/attrubute/attribute-response-model';
import { CacheKeys } from 'src/app/config/cache-keys';
import { BaseRequestService } from 'src/app/components/query-builder/services/entity-services/abstract/base-request.service';

@Injectable({ providedIn: 'root' })
export class AttributeEntityService extends BaseRequestService {
  // Map to store in-flight requests to prevent duplicates
  private inFlightRequests: { [key: string]: Observable<AttributeModel[]> } = {};

  constructor() {
    super();
  }

  getAttributesIsLoading$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  getToAttributesIsLoading$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  getFromAttributesIsLoading$: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  getAttributes(entityLogicalName: string, isLoading: boolean = false, isToAttribute: boolean = false, isFromAttribute: boolean = false): Observable<AttributeModel[]> {
    return this.activeEnvironmentUrl$.pipe(
      tap(() => {
        if (isLoading) {
          if (isToAttribute) {
            this.getToAttributesIsLoading$.next(true);
          } else if (isFromAttribute) {
            this.getFromAttributesIsLoading$.next(true);
          } else {
            this.getAttributesIsLoading$.next(true);
          }
        }
      }),
      switchMap(envUrl => {
        if (!envUrl) {
          if (isLoading) {
            if (isToAttribute) {
              this.getToAttributesIsLoading$.next(false);
            } else if (isFromAttribute) {
              this.getFromAttributesIsLoading$.next(false);
            } else {
              this.getAttributesIsLoading$.next(false);
            }
          }
          return of([]);
        }

        const normalizedEntityName = entityLogicalName.trim().toLowerCase();
        const cacheKey = `${this.prepareEnvUrl(envUrl)}_${CacheKeys.EntityAttributes}_${normalizedEntityName}`;
        
        // Check if we already have cached data
        const cachedAttributes = this.cacheService.getItem<AttributeModel[]>(cacheKey);
        if (cachedAttributes.value) {
          if (isLoading) {
            if (isToAttribute) {
              this.getToAttributesIsLoading$.next(false);
            } else if (isFromAttribute) {
              this.getFromAttributesIsLoading$.next(false);
            } else {
              this.getAttributesIsLoading$.next(false);
            }
          }
          return cachedAttributes.asObservable();
        }
        
        // Check if we have an in-flight request
        if (this.inFlightRequests[cacheKey]) {
          if (isLoading) {
            // Subscribe to the loading state of the in-flight request
            this.inFlightRequests[cacheKey].subscribe({
              complete: () => {
                if (isToAttribute) {
                  this.getToAttributesIsLoading$.next(false);
                } else if (isFromAttribute) {
                  this.getFromAttributesIsLoading$.next(false);
                } else {
                  this.getAttributesIsLoading$.next(false);
                }
              }
            });
          }
          return this.inFlightRequests[cacheKey];
        }
        
        const url = API_ENDPOINTS.attributes.getResourceUrl(envUrl, entityLogicalName);
        
        // Create the API request observable
        const request$ = this.httpClient.get<AttributeResponseModel>(url).pipe(
          map(response => this.toAttributeModels(response)),
          tap(data => { 
            this.cacheService.setItem(data, cacheKey); 
            // Remove from in-flight requests
            delete this.inFlightRequests[cacheKey];
          }),
          tap(() => {
            if (isLoading) {
              if (isToAttribute) {
                this.getToAttributesIsLoading$.next(false);
              } else if (isFromAttribute) {
                this.getFromAttributesIsLoading$.next(false);
              } else {
                this.getAttributesIsLoading$.next(false);
              }
            }
          }),
          tap(attributes => {
          }),
          // Use shareReplay to cache the result for the duration of the request
          // and share it with all subscribers
          shareReplay(1),
          catchError(error => {
            console.error(`Error fetching attributes for entity ${entityLogicalName}:`, error);
            // Remove from in-flight requests on error
            delete this.inFlightRequests[cacheKey];
            return of([]);
          })
        );
        
        // Store the request observable to avoid duplicate requests
        this.inFlightRequests[cacheKey] = request$;
        
        return request$;
      }));
  }

  /**
   * Columns that can be used in `from` / `to` of a link-entity. A wider list than getAttributes,
   * which is limited to form fields and therefore has no primary keys.
   */
  getJoinAttributes(entityLogicalName: string): Observable<AttributeModel[]> {
    return this.activeEnvironmentUrl$.pipe(
      switchMap(envUrl => {
        if (!envUrl) {
          return of([]);
        }

        const cacheKey = `${this.prepareEnvUrl(envUrl)}_${CacheKeys.JoinAttributes}_${entityLogicalName.trim().toLowerCase()}`;

        const cachedAttributes = this.cacheService.getItem<AttributeModel[]>(cacheKey);
        if (cachedAttributes.value) {
          return cachedAttributes.asObservable();
        }

        if (!this.inFlightRequests[cacheKey]) {
          const url = API_ENDPOINTS.joinAttributes.getResourceUrl(envUrl, entityLogicalName);

          this.inFlightRequests[cacheKey] = this.httpClient.get<AttributeResponseModel>(url).pipe(
            map(response => this.toAttributeModels(response)),
            tap(data => this.cacheService.setItem(data, cacheKey)),
            // Success is cached above; on error nothing is kept, so the next call sends a new request
            finalize(() => delete this.inFlightRequests[cacheKey]),
            shareReplay(1),
            catchError(error => {
              console.error(`Error fetching join attributes for entity ${entityLogicalName}:`, error);
              return of([]);
            })
          );
        }

        return this.inFlightRequests[cacheKey];
      }));
  }

  private toAttributeModels({ value }: AttributeResponseModel): AttributeModel[] {
    return value.map(({
      LogicalName: logicalName,
      DisplayName: { UserLocalizedLabel } = {},
      AttributeType: attributeType }): AttributeModel =>
    ({
      logicalName,
      displayName: UserLocalizedLabel ? UserLocalizedLabel.Label : '',
      attributeType
    }));
  }

}
