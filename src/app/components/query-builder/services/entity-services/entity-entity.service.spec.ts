import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { ACTIVE_ACCOUNT_MODEL, ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { EntityModel } from 'src/app/models/incoming/environment/entity-model';
import { EntityEntityService } from './entity-entity.service';

describe('EntityEntityService', () => {
  const envUrl = 'https://test.example.invalid';
  let service: EntityEntityService;
  let http: HttpTestingController;

  const response = {
    value: [
      { LogicalName: 'account', DisplayName: { UserLocalizedLabel: { Label: 'Account' } }, EntitySetName: 'accounts' },
      { LogicalName: 'contact', DisplayName: {}, EntitySetName: 'contacts' },
    ]
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject({ url: envUrl, apiUrl: envUrl, friendlyName: 'Test', urlName: 'test' }) },
        { provide: ACTIVE_ACCOUNT_MODEL, useValue: new BehaviorSubject(null) },
      ]
    });
    service = TestBed.inject(EntityEntityService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function isEntitiesRequest(url: string): boolean {
    return url.startsWith(`${envUrl}/api/data/v9.2/EntityDefinitions`);
  }

  it('shares one HTTP request between concurrent subscribers on a cold cache', () => {
    const results: EntityModel[][] = [];
    for (let i = 0; i < 5; i++) {
      service.getEntities().subscribe(entities => results.push(entities));
    }

    const requests = http.match(request => isEntitiesRequest(request.url));
    expect(requests.length).toBe(1);
    requests[0].flush(response);

    expect(results.length).toBe(5);
    expect(results.every(entities => entities.length === 2)).toBeTrue();
    expect(results[0][0]).toEqual({ logicalName: 'account', displayName: 'Account', entitySetName: 'accounts' });

    // Later subscribers are served from the cache
    let cached: EntityModel[];
    service.getEntities().subscribe(entities => cached = entities);
    http.expectNone(request => isEntitiesRequest(request.url));
    expect(cached.length).toBe(2);
  });

  it('does not keep a failed request: the next call sends a new one', () => {
    const errors: unknown[] = [];
    service.getEntities().subscribe({ error: error => errors.push(error) });
    service.getEntities().subscribe({ error: error => errors.push(error) });

    const failed = http.match(request => isEntitiesRequest(request.url));
    expect(failed.length).toBe(1);
    failed[0].flush('boom', { status: 500, statusText: 'Server Error' });
    expect(errors.length).toBe(2);

    let entities: EntityModel[];
    service.getEntities().subscribe(result => entities = result);
    const retry = http.match(request => isEntitiesRequest(request.url));
    expect(retry.length).toBe(1);
    retry[0].flush(response);
    expect(entities.length).toBe(2);
  });
});
