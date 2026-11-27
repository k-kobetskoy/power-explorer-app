import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { EnvironmentModel } from '../models/environment-model';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from '../models/tokens';
import { DesktopAuthService } from './desktop-auth.service';
import { ElectronService } from './electron.service';
import { ErrorDialogService } from './error-dialog.service';
import { NotificationService } from './notification.service';

describe('DesktopAuthService sign-in prompt', () => {
  const environment = { url: 'https://org.crm.dynamics.com', friendlyName: 'Test' } as EnvironmentModel;

  let environment$: BehaviorSubject<EnvironmentModel>;
  let closed$: Subject<boolean>;
  let dialog: jasmine.SpyObj<ErrorDialogService>;
  let login: jasmine.Spy;
  let finishLogin: (result: { success: boolean }) => void;
  let service: DesktopAuthService;

  beforeEach(() => {
    environment$ = new BehaviorSubject<EnvironmentModel>(environment);
    dialog = jasmine.createSpyObj<ErrorDialogService>('ErrorDialogService', ['showError']);
    dialog.showError.and.callFake(() => {
      closed$ = new Subject<boolean>();
      return { afterClosed: () => closed$ } as any;
    });
    login = jasmine.createSpy('login').and.callFake(() => new Promise(resolve => finishLogin = resolve));

    TestBed.configureTestingModule({
      providers: [
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: environment$ },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
        { provide: ElectronService, useValue: { isElectronApp: true, electron: {}, receive: () => { }, auth: { login } } },
        { provide: ErrorDialogService, useValue: dialog },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError', 'showInfo']) },
        { provide: Router, useValue: {} },
        { provide: ActivatedRoute, useValue: {} }
      ]
    });
    service = TestBed.inject(DesktopAuthService);
  });

  const answer = (accepted: boolean) => {
    closed$.next(accepted);
    closed$.complete();
  };

  it('shows one prompt for any number of failed requests', () => {
    service.offerSignIn(environment);
    service.offerSignIn(environment);

    expect(dialog.showError).toHaveBeenCalledTimes(1);
  });

  it('does not sign in when the prompt is dismissed, and may prompt again later', () => {
    service.offerSignIn(environment);
    answer(false);
    service.offerSignIn(environment);

    expect(login).not.toHaveBeenCalled();
    expect(dialog.showError).toHaveBeenCalledTimes(2);
  });

  it('signs in once on request and stays quiet until the sign-in ends', async () => {
    service.offerSignIn(environment);
    answer(true);
    service.offerSignIn(environment);

    expect(login).toHaveBeenCalledOnceWith(environment);
    expect(dialog.showError).toHaveBeenCalledTimes(1);

    finishLogin({ success: false });
    await new Promise(resolve => setTimeout(resolve));
    service.offerSignIn(environment);

    expect(dialog.showError).toHaveBeenCalledTimes(2);
    // a failed sign-in keeps the environment
    expect(environment$.value).toBe(environment);
  });
});
