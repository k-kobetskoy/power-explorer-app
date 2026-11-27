import { Inject, Injectable, NgZone } from '@angular/core';

import { BehaviorSubject, Observable, from, of } from 'rxjs';
import { map, catchError, tap, finalize, switchMap } from 'rxjs/operators';
import { ACTIVE_ENVIRONMENT_MODEL, ACTIVE_ACCOUNT_MODEL } from '../models/tokens';
import { EnvironmentModel } from '../models/environment-model';
import { AccountInfo } from '@azure/msal-browser';
import { NotificationService } from './notification.service';
import { ActivatedRoute, Router } from '@angular/router';
import { ElectronService, TokenResponse } from './electron.service';
import { ErrorDialogService } from './error-dialog.service';
import { isSameEnvironment } from './environment-url';

@Injectable({ providedIn: 'root' })

export class DesktopAuthService {
  private signInPromptOpen = false;
  private signInsInProgress = 0;

  constructor(
    @Inject(ACTIVE_ENVIRONMENT_MODEL) private activeEnvironmentModel: BehaviorSubject<EnvironmentModel>,
    @Inject(ACTIVE_ACCOUNT_MODEL) private activeAccount: BehaviorSubject<AccountInfo>,
    private electronService: ElectronService,
    private notificationService: NotificationService,
    private router: Router,
    private route: ActivatedRoute,
    private errorDialogService: ErrorDialogService,
    private ngZone: NgZone
  ) { 
    this.initializeListeners();
  }

  private initializeListeners(): void {
    if (!this.electronService.isElectronApp || !this.electronService.electron) {
      return;
    }

    // Listen for active environment changes from electron side
    this.listen('environment-changed', (environment: EnvironmentModel) => {
      this.publishEnvironment(environment || null);
    });

    // Listen for active account changes from electron side
    this.listen('account-changed', (account: AccountInfo) => {
      if (account) {
        this.activeAccount.next(account);
      } else {
        this.activeAccount.next(null);
      }
    });

    // Listen for auth success/failure messages
    this.listen('auth-success', (data: { account: AccountInfo }) => {
      if (data && data.account) {
        this.activeAccount.next(data.account);
        this.notificationService.showSuccess('Login successful');
        // Navigate to home or dashboard
        this.router.navigate(['/']);
      }
    });

    this.listen('auth-failed', (data: { error: string, errorDescription: string }) => {
      console.error('[ELECTRON-AUTH] Authentication failed:', data?.error);
      this.notificationService.showError(`Login failed: ${data.errorDescription || data.error || 'Unknown error'}`);
    });
  }

  // IPC callbacks arrive outside Angular's zone, so views would not update without run()
  private listen(channel: string, handler: (data: any) => void): void {
    this.electronService.receive(channel, data => this.ngZone.run(() => handler(data)));
  }

  // The main process announces a change and the call that caused it returns the same model:
  // publishing it twice would restart every request that follows the environment
  private publishEnvironment(environment: EnvironmentModel | null): void {
    const current = this.activeEnvironmentModel.value;
    const unchanged = current?.apiUrl === environment?.apiUrl
      && current?.url === environment?.url
      && current?.friendlyName === environment?.friendlyName;

    if (!unchanged) {
      this.activeEnvironmentModel.next(environment);
    }
  }

  /**
   * Handle auth redirect params
   * @param params URL parameters from the redirect
   */
  handleAuthRedirect(params: Record<string, string>): Observable<boolean> {
    if (!this.electronService.isElectronApp) {
      return of(false);
    }

    return from(this.electronService.auth.handleRedirect(params)).pipe(
      map(result => {
        return result.success;
      }),
      catchError(error => {
        console.error('[ELECTRON-AUTH] Error handling redirect:', error);
        return of(false);
      })
    );
  }

  setActiveEnvironment(environmentModel: EnvironmentModel): Observable<boolean> {
    if (!this.electronService.isElectronApp) {
      return of(false);
    }


    // Connecting may sign in by itself: no prompt on top of it
    this.signInsInProgress++;

    return from(this.electronService.environment.setActive(environmentModel)).pipe(
      finalize(() => this.signInsInProgress--),
      map(result => {
        
        if (result.success) {
          this.publishEnvironment(environmentModel);
          this.notificationService.showSuccess(`Connected to ${environmentModel.friendlyName}`);
        } else {
          this.notificationService.showError(`Failed to connect to ${environmentModel.friendlyName}`);
        }
        
        this.updateActiveAccount();

        return result.success;
      }),
      catchError(error => {
        console.error('[ELECTRON-AUTH] Error setting environment URL:', error);
        this.notificationService.showError(`Error connecting to ${environmentModel.friendlyName}`);
        return of(false);
      })
    );
  }

  getEnvironments(): Observable<EnvironmentModel[]> {
    if (!this.electronService.isElectronApp) {
      return of([]);
    }

    return from(this.electronService.environment.getModels()).pipe(
      map(result => result.environments)
    );
  }

  updateActiveAccount(): void {
    if (!this.electronService.isElectronApp || !this.electronService.electron) {
      return;
    }
  
    from(this.electronService.auth.getActiveAccount())
      .pipe(
        catchError(error => {
          console.error('[DESKTOP-AUTH] Error getting the active account:', error?.message);
          return of(null);
        })
      )
      .subscribe(account => {
        this.activeAccount.next(account);
      });
  }

  updateActiveEnvironment(): void {
    if (!this.electronService.isElectronApp || !this.electronService.electron) {
      return;
    }

    from(this.electronService.environment.getActive()).subscribe(result => {
      if (result.success && result.environment) {
        this.publishEnvironment(result.environment);
      }
    });
  }

  /**
   * Initiate the login process
   */
  login(environmentModel: EnvironmentModel): Observable<boolean> {
    if (!this.electronService.isElectronApp || !this.electronService.electron) {
      return of(false);
    }

    this.signInsInProgress++;

    // A failed or abandoned sign-in leaves the active environment and account as they are
    return from(this.electronService.auth.login(environmentModel)).pipe(
      finalize(() => this.signInsInProgress--),
      tap(result => {
        if (result.success) {
          this.activeAccount.next(result.account);
          // Publishing the environment again re-sends the requests that were waiting for this sign-in.
          // If the user moved to another environment or logged out meanwhile, leave that as it is
          const current = this.activeEnvironmentModel.value;
          if (current && isSameEnvironment(current, environmentModel)) {
            this.activeEnvironmentModel.next(current);
          }
          this.notificationService.showSuccess(`Successfully logged in to ${environmentModel.friendlyName}`);
        } else {
          this.notificationService.showError(`Login failed: ${result.error || 'Unknown error'}`);
        }
      }),
      map(result => result.success),
      catchError(error => {
        this.notificationService.showError('Login error: ' + (error.message || 'Unknown error'));
        return of(false);
      })
    );
  }

  /**
   * Ask the user to sign in again. Does nothing while a prompt is open or a sign-in is running,
   * so any number of failed requests produce one prompt.
   */
  offerSignIn(environmentModel: EnvironmentModel): void {
    if (this.signInPromptOpen || this.signInsInProgress > 0) {
      return;
    }
    this.signInPromptOpen = true;

    this.errorDialogService.showError({
      title: 'Sign in required',
      message: `Sign in to continue working with ${environmentModel.friendlyName}.`,
      actionLabel: 'Sign in'
    }).afterClosed().pipe(
      tap(() => this.signInPromptOpen = false),
      switchMap(accepted => accepted ? this.login(environmentModel) : of(false))
    ).subscribe();
  }

  /**
   * Get an access token for the specified scopes
   */
  getToken(environmentModel: EnvironmentModel): Observable<TokenResponse> {
    const unavailable: TokenResponse = { success: false, error: 'Could not get an access token' };

    if (!this.electronService.isElectronApp || !this.electronService.electron) {
      return of(unavailable);
    }

    return from(this.electronService.auth.getToken(environmentModel)).pipe(
      catchError(() => of(unavailable))
    );
  }

  /**
   * Log the user out
   */
  logout(): Observable<boolean> {
    if (!this.electronService.isElectronApp) {
      return of(false);
    }

    return from(this.electronService.auth.logout()).pipe(
      tap(result => {
        this.activeAccount.next(null);
        this.activeEnvironmentModel.next(null);
        this.notificationService.showInfo('You have been logged out');
      }),
      map(result => true), 
      catchError(error => {
        this.activeAccount.next(null);
        this.activeEnvironmentModel.next(null);
        this.notificationService.showInfo('You have been logged out');
        return of(true); // Always consider logout successful
      })
    );
  }

} 