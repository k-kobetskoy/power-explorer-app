import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { EnvironmentModel } from '../models/environment-model';
import { RequestNotSentError } from '../models/request-not-sent-error';
import { ACTIVE_ENVIRONMENT_MODEL } from '../models/tokens';
import { DesktopAuthService } from './desktop-auth.service';
import { ElectronHttpInterceptor } from './electron-http-interceptor.service';

describe('ElectronHttpInterceptor', () => {
  const environment = {
    url: 'https://org.crm.dynamics.com',
    apiUrl: 'https://org.api.crm.dynamics.com',
    friendlyName: 'Test',
    urlName: 'org'
  };
  const API_URL = `${environment.url}/api/data/v9.2/accounts`;

  let environment$: BehaviorSubject<EnvironmentModel>;
  let auth: jasmine.SpyObj<DesktopAuthService>;
  let client: HttpClient;
  let http: HttpTestingController;

  beforeEach(() => {
    environment$ = new BehaviorSubject<EnvironmentModel>(environment);
    auth = jasmine.createSpyObj<DesktopAuthService>('DesktopAuthService', ['getToken', 'offerSignIn']);
    auth.getToken.and.returnValue(of({ success: true, accessToken: 'test-token' }));

    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: ElectronHttpInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: environment$ },
        { provide: DesktopAuthService, useValue: auth }
      ]
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Requests a URL that must not leave the app and returns the error the caller gets. */
  const blockedError = (url: string): RequestNotSentError => {
    let received: RequestNotSentError;
    client.get(url).subscribe({ error: error => received = error });
    http.expectNone(url);
    return received;
  };

  [API_URL, `${environment.apiUrl}/api/data/v9.2/accounts`].forEach(url => {
    it(`attaches the token to ${url}`, () => {
      client.get(url).subscribe();

      expect(http.expectOne(url).request.headers.get('Authorization')).toBe('Bearer test-token');
    });
  });

  ['assets/configuration.json', 'https://example.com/styles.css', 'https://example.com/?next=/api/data/'].forEach(url => {
    it(`leaves ${url} alone`, () => {
      client.get(url).subscribe();

      expect(http.expectOne(url).request.headers.has('Authorization')).toBeFalse();
      expect(auth.getToken).not.toHaveBeenCalled();
    });
  });

  it('does not send an API request to another origin', () => {
    expect(blockedError('https://other.crm.dynamics.com/api/data/v9.2/accounts')).toBeInstanceOf(RequestNotSentError);
    expect(auth.getToken).not.toHaveBeenCalled();
  });

  it('does not send an API request when there is no active environment', () => {
    environment$.next(null);

    expect(blockedError(API_URL)).toBeInstanceOf(RequestNotSentError);
    expect(auth.getToken).not.toHaveBeenCalled();
  });

  it('offers to sign in instead of sending when a sign-in is required', () => {
    auth.getToken.and.returnValue(of({ success: false, loginRequired: true }));

    expect(blockedError(API_URL).signInRequired).toBeTrue();
    expect(auth.offerSignIn).toHaveBeenCalledOnceWith(environment);
  });

  it('reports a token failure without offering to sign in', () => {
    auth.getToken.and.returnValue(of({ success: false, error: 'No network' }));

    const error = blockedError(API_URL);

    expect(error.message).toBe('No network');
    expect(error.signInRequired).toBeFalse();
    expect(auth.offerSignIn).not.toHaveBeenCalled();
  });
});
