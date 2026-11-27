import { AbstractControl } from '@angular/forms';
import { Observable, of } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, map, switchMap, takeUntil } from 'rxjs/operators';
import { IAttributeData } from '../../../models/constants/attribute-data';
import { QueryNode } from '../../../models/query-node';

export interface AttributeBindingOptions<T> {
  /** Attribute value to control value. Receives null when the node has no such attribute. */
  fromModel?: (value: string | null) => T;
  toModel?: (value: T) => string;
  /** Returning false keeps a control value out of the node. */
  canWrite?: (value: T) => boolean;
  /** Delay of the writes to the node, in milliseconds. */
  debounce?: number;
}

/**
 * Binds a control to an attribute of a node, both ways, until destroy$ emits.
 * The control follows the node without emitting, so following never writes back.
 */
export function bindControlToAttribute<T = string>(
  control: AbstractControl,
  node: QueryNode,
  attributeData: IAttributeData,
  destroy$: Observable<void>,
  options: AttributeBindingOptions<T> = {}
): void {
  const fromModel = options.fromModel ?? ((value: string | null) => value as unknown as T);
  const toModel = options.toModel ?? ((value: T) => value as unknown as string);

  node.attributes$.pipe(
    map(attributes => attributes.find(attribute => attribute.editorName === attributeData.EditorName)),
    distinctUntilChanged(),
    switchMap(attribute => attribute ? attribute.value$.pipe(map(value => ({ value }))) : of(null)),
    takeUntil(destroy$)
  ).subscribe(state => {
    // An empty control already shows a missing attribute
    if (!state && !control.value) {
      return;
    }

    const value = fromModel(state ? state.value : null);
    if (value !== control.value) {
      control.setValue(value, { emitEvent: false });
    }
  });

  // No distinctUntilChanged: the node also changes the control (without an event),
  // so a value equal to the last emitted one can still be a change
  const changes$: Observable<T> = options.debounce
    ? control.valueChanges.pipe(debounceTime(options.debounce))
    : control.valueChanges;

  changes$.pipe(
    filter(value => !options.canWrite || options.canWrite(value)),
    takeUntil(destroy$)
  ).subscribe(value => node.setAttribute(attributeData, toModel(value)));
}
