import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, Subject } from 'rxjs';
import { ExternalLinkService } from 'src/app/services/external-link.service';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { provideQueryBuilderTesting } from '../services/query-builder-test-providers';
import { ExecutionState, MatTableRawData, XmlExecutorService } from '../services/xml-executor.service';
import { ResultTableComponent } from './result-table.component';

describe('ResultTableComponent', () => {
  const link = "https://org.example.com/main.aspx?etn=account&id=1'";
  const result: MatTableRawData = {
    header: { name: { logicalName: 'name', displayName: 'Account Name', type: 'String' } },
    rows: [{
      rowIndex: 0,
      attributes: new Map([['name', { attributeLogicalName: 'name', attributeRawValue: 'Contoso' }]]),
      rowJson: {},
      dataverseRowLink: link
    }]
  };

  let state$: Subject<ExecutionState>;
  let externalLink: jasmine.SpyObj<ExternalLinkService>;
  let fixture: ComponentFixture<ResultTableComponent>;

  const text = () => (fixture.nativeElement as HTMLElement).textContent;
  const emit = (state: ExecutionState) => {
    state$.next(state);
    fixture.detectChanges();
    flush();
  };

  beforeEach(() => {
    state$ = new BehaviorSubject<ExecutionState>({ status: 'idle' });
    externalLink = jasmine.createSpyObj<ExternalLinkService>('ExternalLinkService', ['openExternalLink']);
    TestBed.configureTestingModule({
      imports: [ResultTableComponent],
      providers: [
        ...provideQueryBuilderTesting(),
        provideNoopAnimations(),
        { provide: ACTIVE_ENVIRONMENT_MODEL, useValue: new BehaviorSubject(null) },
        { provide: ExternalLinkService, useValue: externalLink },
        { provide: XmlExecutorService, useValue: { state$, getRawDataverseRawResult: () => new BehaviorSubject(null) } }
      ]
    });
    fixture = TestBed.createComponent(ResultTableComponent);
    fixture.detectChanges();
  });

  it('opens the record from the row number', fakeAsync(() => {
    emit({ status: 'rows', result });

    (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('a.row-number-link').click();
    flush();

    expect(externalLink.openExternalLink).toHaveBeenCalledOnceWith(link);
  }));

  it('does not bring previous rows back after an empty result when the format is toggled', fakeAsync(() => {
    emit({ status: 'rows', result });
    expect(text()).toContain('Contoso');

    emit({ status: 'loading' });
    expect(text()).not.toContain('Contoso');

    emit({ status: 'empty' });
    fixture.componentInstance.toggleValueFormat();
    fixture.detectChanges();

    expect(text()).not.toContain('Contoso');
    expect(text()).toContain('No results');
  }));

  it('shows the error message instead of the table or "No results"', fakeAsync(() => {
    emit({ status: 'rows', result });
    emit({ status: 'processingError', message: 'Rows were received (1) but could not be displayed' });
    fixture.componentInstance.toggleValueFormat();
    fixture.detectChanges();

    expect(text()).toContain('could not be displayed');
    expect(text()).not.toContain('Contoso');
    expect(text()).not.toContain('No results');
  }));
});
