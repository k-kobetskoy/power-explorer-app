import { EnvironmentProviders, Provider } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';

/**
 * Providers for unit tests of the query builder services (node tree, rendering, parsing).
 * No active environment is set, so the server-backed validators never issue an HTTP request.
 */
export function provideQueryBuilderTesting(): (Provider | EnvironmentProviders)[] {
  return [
    provideHttpClient(),
    provideHttpClientTesting(),
    { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject(null) },
    { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
  ];
}
