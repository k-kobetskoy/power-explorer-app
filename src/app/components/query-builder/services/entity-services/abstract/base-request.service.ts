import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, EMPTY, MonoTypeOperatorFunction, Observable, catchError, filter, map, throwError } from 'rxjs';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { CacheStorageService } from 'src/app/services/data-sorage/cache-storage.service';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { RequestNotSentError } from 'src/app/models/request-not-sent-error';

@Injectable({ providedIn: 'root' })
export abstract class BaseRequestService {

    protected activeEnvironmentUrl$: Observable<string>;

    protected httpClient: HttpClient = inject(HttpClient);
    protected cacheService: CacheStorageService = inject(CacheStorageService);
    protected activeEnvironmentUrlSubject$: BehaviorSubject<EnvironmentModel> = inject(ACTIVE_ENVIRONMENT_MODEL);

    constructor() {        
        // Initialize activeEnvironmentUrl$ from the activeEnvironmentUrlSubject$
        this.activeEnvironmentUrl$ = this.activeEnvironmentUrlSubject$.pipe(
            filter(env => !!env),
            map(env => env.url)
        );
    }

    /**
     * For a request made inside a stream that follows the environment: when it was not sent because
     * a sign-in is required, the stream stays alive and sends it again once the sign-in publishes
     * the environment. Other errors pass through.
     */
    protected waitForSignIn<T>(isLoading$: BehaviorSubject<boolean>): MonoTypeOperatorFunction<T> {
        return catchError(error => {
            if (error instanceof RequestNotSentError && error.signInRequired) {
                isLoading$.next(false);
                return EMPTY;
            }
            return throwError(() => error);
        });
    }

    protected prepareEnvUrl(envUrl: string): string {
        return envUrl?.replace(/[^a-zA-Z0-9]/g, '_');
    }
}
