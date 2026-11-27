import { HTTP_INTERCEPTORS, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { DesktopAuthService } from 'src/app/services/desktop-auth.service';
import { ElectronHttpInterceptor } from 'src/app/services/electron-http-interceptor.service';
import { ElectronService } from 'src/app/services/electron.service';
import { ErrorDialogService } from 'src/app/services/error-dialog.service';
import { NotificationService } from 'src/app/services/notification.service';
import { AttributeData } from '../models/constants/attribute-data';
import { BooleanEntityService } from './entity-services/boolean-entity.service';
import { EntityEntityService } from './entity-services/entity-entity.service';
import { PicklistEntityService } from './entity-services/picklist-entity.service';
import { StatusEntityService } from './entity-services/status-entity.service';
import { NodeTreeService } from './node-tree.service';

describe('recovery after a required sign-in', () => {
  const environment: EnvironmentModel = {
    url: 'https://org.crm.dynamics.com',
    apiUrl: 'https://org.crm.dynamics.com',
    friendlyName: 'Test',
    urlName: 'org'
  };
  const entities = {
    value: [{ LogicalName: 'account', DisplayName: {}, EntitySetName: 'accounts' }]
  };

  let signedIn: boolean;
  let prompt$: Subject<boolean>;
  let dialog: jasmine.SpyObj<ErrorDialogService>;
  let http: HttpTestingController;

  beforeEach(() => {
    signedIn = false;
    dialog = jasmine.createSpyObj<ErrorDialogService>('ErrorDialogService', ['showError']);
    dialog.showError.and.callFake(() => {
      prompt$ = new Subject<boolean>();
      return { afterClosed: () => prompt$ } as any;
    });
    const auth = {
      getToken: () => Promise.resolve(signedIn
        ? { success: true, accessToken: 'test-token' }
        : { success: false, loginRequired: true }),
      login: () => {
        signedIn = true;
        return Promise.resolve({ success: true });
      }
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: HTTP_INTERCEPTORS, useClass: ElectronHttpInterceptor, multi: true },
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject(environment) },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
        { provide: ElectronService, useValue: { isElectronApp: true, electron: {}, receive: () => { }, auth } },
        { provide: ErrorDialogService, useValue: dialog },
        { provide: NotificationService, useValue: jasmine.createSpyObj('NotificationService', ['showSuccess', 'showError']) },
        { provide: Router, useValue: {} },
        { provide: ActivatedRoute, useValue: {} }
      ]
    });
    TestBed.inject(DesktopAuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const signIn = () => {
    expect(dialog.showError).toHaveBeenCalledTimes(1);
    prompt$.next(true);
    prompt$.complete();
    tick();
  };

  it('validates the entity name again and fills the entity list', fakeAsync(() => {
    const entity = TestBed.inject(NodeTreeService).getNodeTree().value.root.next;
    entity.setAttribute(AttributeData.Entity.Name, 'account');
    let valid: boolean;
    let listed: string[];
    const nameAttribute = entity.attributes$.value.find(attribute => attribute.editorName === AttributeData.Entity.Name.EditorName);
    nameAttribute.validationResult$.subscribe(result => valid = result.isValid);
    TestBed.inject(EntityEntityService).getEntities().subscribe(list => listed = list.map(item => item.logicalName));
    tick();

    // not answered yet: neither valid nor invalid
    expect(valid).toBeUndefined();
    expect(listed).toBeUndefined();

    signIn();
    http.expectOne(request => request.url.includes('/EntityDefinitions?')).flush(entities);
    tick();

    expect(listed).toEqual(['account']);
    expect(valid).toBeTrue();
    expect(entity.entitySetName$.value).toBe('accounts');

    entity.setAttribute(AttributeData.Entity.Name, 'missing');
    tick();
    expect(valid).toBeFalse();
    flush();
  }));

  const optionRequests: [string, () => Observable<unknown>, object][] = [
    ['picklist options', () => TestBed.inject(PicklistEntityService).getOptions('account', 'a', 'Picklist'), { Options: [] }],
    ['boolean values', () => TestBed.inject(BooleanEntityService).getBooleanValues('account', 'a'), {
      TrueOption: { Value: 1, Label: { UserLocalizedLabel: { Label: 'Yes' } } },
      FalseOption: { Value: 0, Label: { UserLocalizedLabel: { Label: 'No' } } }
    }],
    ['status codes', () => TestBed.inject(StatusEntityService).getStateOrStatusCodeValues('account', 'statecode'), { Options: [] }]
  ];

  optionRequests.forEach(([name, request, response]) => {
    it(`requests ${name} again`, fakeAsync(() => {
      let received: unknown;
      request().subscribe(value => received = value);
      tick();

      signIn();
      http.expectOne(() => true).flush(response);

      expect(received).toBeDefined();
    }));
  });
});
