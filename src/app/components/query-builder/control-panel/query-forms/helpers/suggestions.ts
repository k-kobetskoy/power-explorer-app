import { AbstractControl } from '@angular/forms';
import { Observable, combineLatest } from 'rxjs';
import { map, startWith } from 'rxjs/operators';

/** The most options an autocomplete list shows. */
export const SUGGESTION_LIMIT = 50;

interface NamedModel {
  logicalName: string;
  displayName: string;
}

/** First SUGGESTION_LIMIT entities or attributes whose logical or display name contains the search text. */
export function filterByName<T extends NamedModel>(items: T[], search: string): T[] {
  const text = (search ?? '').toLowerCase();

  return items
    .filter(item =>
      item.logicalName.toLowerCase().includes(text) ||
      item.displayName.toLowerCase().includes(text))
    .slice(0, SUGGESTION_LIMIT);
}

/** Suggestions for an autocomplete input: follows both the typed text and the list. */
export function suggestions$<T extends NamedModel>(control: AbstractControl, items$: Observable<T[]>): Observable<T[]> {
  return combineLatest([
    control.valueChanges.pipe(startWith(control.value)),
    items$
  ]).pipe(
    map(([search, items]) => filterByName(items, search))
  );
}
