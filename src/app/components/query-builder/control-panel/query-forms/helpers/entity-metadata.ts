import { Observable, Subject, of } from 'rxjs';
import { catchError, distinctUntilChanged, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { AttributeNames } from '../../../models/constants/attribute-names';
import { QueryNode } from '../../../models/query-node';

/** A list (or other metadata) that belongs to an entity, and how to load it. */
export interface MetadataSource<T> {
  load: (entityName: string) => Observable<T>;
  /** Emitted when there is no entity to load for, or the load fails. */
  empty: T;
  /** Spinner flag of the load; some services leave it on when a request fails. */
  loading$?: Subject<boolean>;
}

/** Logical name of an entity or link-entity node. Follows the name being added, changed or removed. */
function entityName$(entityNode: QueryNode): Observable<string> {
  return entityNode.attributes$.pipe(
    map(attributes => attributes.find(attribute => attribute.editorName === AttributeNames.entityName)),
    distinctUntilChanged(),
    switchMap(nameAttribute => nameAttribute ? nameAttribute.value$ : of('')),
    distinctUntilChanged()
  );
}

function loadByName$<T>(entityNode: QueryNode, source: MetadataSource<T>): Observable<T> {
  return entityName$(entityNode).pipe(
    switchMap(entityName => {
      if (!entityName) {
        return of(source.empty);
      }

      // Caught per name: a failed load must not end the stream
      return source.load(entityName).pipe(
        catchError(error => {
          console.error(`Error loading metadata of entity ${entityName}:`, error);
          return of(source.empty);
        }),
        tap(() => source.loading$?.next(false))
      );
    })
  );
}

/** Metadata of the entity a node names itself, whatever the validation state of the node. */
export function entityMetadata$<T>(entityNode: QueryNode, source: MetadataSource<T>): Observable<T> {
  return loadByName$(entityNode, source).pipe(shareReplay({ bufferSize: 1, refCount: true }));
}

/** Metadata of a parent entity: empty while the parent is missing or invalid. */
export function parentEntityMetadata$<T>(parentEntityNode: QueryNode, source: MetadataSource<T>): Observable<T> {
  if (!parentEntityNode) {
    return of(source.empty);
  }

  return parentEntityNode.validationResult$.pipe(
    map(result => result.isValid),
    distinctUntilChanged(),
    switchMap(isValid => isValid ? loadByName$(parentEntityNode, source) : of(source.empty)),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
