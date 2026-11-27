import { Injectable, Inject } from '@angular/core';
import { HttpInterceptor, HttpRequest, HttpHandler, HttpEvent } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { DesktopAuthService } from './desktop-auth.service';
import { ACTIVE_ENVIRONMENT_MODEL } from '../models/tokens';
import { EnvironmentModel } from '../models/environment-model';
import { RequestNotSentError } from '../models/request-not-sent-error';
import { isEnvironmentOrigin } from './environment-url';
import { BehaviorSubject } from 'rxjs';

const DATAVERSE_API_PATH = /\/api\/(data|crm)\//;

@Injectable()
export class ElectronHttpInterceptor implements HttpInterceptor {

  constructor(@Inject(ACTIVE_ENVIRONMENT_MODEL) private activeEnvironmentModel: BehaviorSubject<EnvironmentModel>, private electronAuthService: DesktopAuthService) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const url = this.parseUrl(req.url);

    // Skip non-secure endpoints or non-API endpoints
    if (url?.protocol !== 'https:' || !DATAVERSE_API_PATH.test(url.pathname)) {
      return next.handle(req);
    }

    // The token goes to the active environment only
    const environment = this.activeEnvironmentModel.value;
    if (!environment || !isEnvironmentOrigin(url.origin, environment)) {
      return throwError(() => new RequestNotSentError('The request does not target the active environment'));
    }

    // Get token from Electron auth service
    return this.electronAuthService.getToken(environment).pipe(
      switchMap(response => {
        if (response.loginRequired) {
          this.electronAuthService.offerSignIn(environment);
          return throwError(() => new RequestNotSentError('Sign in is required to access this environment', true));
        }

        if (!response.success || !response.accessToken) {
          return throwError(() => new RequestNotSentError(response.error || 'Could not get an access token'));
        }

        // Clone the request and add the authorization header
        const authReq = req.clone({
          setHeaders: {
            Authorization: `Bearer ${response.accessToken}`
          }
        });

        return next.handle(authReq);
      })
    );
  }

  private parseUrl(url: string): URL | null {
    try {
      return new URL(url);
    } catch {
      return null; // relative address: an asset of the app itself
    }
  }
}
