import { Injectable } from '@angular/core';

export const DEFAULT_PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];
export const MIN_FITTED_PAGE_SIZE = 10;
export const FALLBACK_PAGE_SIZE = 25;

/**
 * The number of rows that fit into the rows area without a vertical scroll, at least 10.
 * 25 when a height cannot be measured (it is 0, e.g. in a hidden panel).
 */
export function fitPageSize(rowsAreaHeight: number, rowHeight: number): number {
  if (!(rowsAreaHeight > 0) || !(rowHeight > 0)) {
    return FALLBACK_PAGE_SIZE;
  }

  return Math.max(MIN_FITTED_PAGE_SIZE, Math.floor(rowsAreaHeight / rowHeight));
}

/** The page size picked in the paginator. Kept in memory only, until the app restarts. */
@Injectable({ providedIn: 'root' })
export class PageSizePreference {
  userPageSize: number | null = null;
}
