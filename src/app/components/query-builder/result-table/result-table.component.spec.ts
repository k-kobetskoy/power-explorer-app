import { ComponentFixture, TestBed, fakeAsync, flush } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { BehaviorSubject, Subject } from 'rxjs';
import { ExternalLinkService } from 'src/app/services/external-link.service';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { provideQueryBuilderTesting } from '../services/query-builder-test-providers';
import { ExecutionState, MatTableRawData, QueryContinuation, XmlExecutorService } from '../services/xml-executor.service';
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

  it('shows the columns in the order of the header', fakeAsync(() => {
    const column = (name: string) => ({ logicalName: name, displayName: name, type: 'String' });
    const header = { name: column('name'), createdon: column('createdon'), accountid: column('accountid') };

    emit({ status: 'rows', result: { ...result, header } });

    expect(fixture.componentInstance.displayedColumns).toEqual(['No.', 'name', 'createdon', 'accountid']);
  }));

  const manyRows = (count: number): MatTableRawData => ({
    header: result.header,
    rows: Array.from({ length: count }, (_, rowIndex) => ({ ...result.rows[0], rowIndex }))
  });

  it('fits the page size to the height of the table without a vertical scroll', fakeAsync(() => {
    const host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    host.style.height = '600px';
    host.style.width = '900px';

    emit({ status: 'rows', result: manyRows(200), executionId: 1 });

    const component = fixture.componentInstance;
    const scroll = host.querySelector<HTMLElement>('.table-scroll-container');
    const rowHeight = host.querySelector('tr.mat-mdc-row').getBoundingClientRect().height;

    expect(component.pageSize).toBeGreaterThan(10);
    expect(component.pageSizeOptions).toContain(component.pageSize);
    expect(host.querySelectorAll('tr.mat-mdc-row').length).toBe(component.pageSize);
    expect(scroll.scrollHeight).toBeLessThanOrEqual(scroll.clientHeight);
    // no room is left for another row
    expect(scroll.clientHeight - scroll.scrollHeight).toBeLessThan(rowHeight);
    host.remove();
  }));

  it('keeps the size picked in the paginator for the next results', fakeAsync(() => {
    emit({ status: 'rows', result: manyRows(200), executionId: 1 });
    fixture.componentInstance.onPageChange({ pageIndex: 0, pageSize: 100, length: 200 });

    emit({ status: 'rows', result: manyRows(200), executionId: 2 });

    expect(fixture.componentInstance.pageSize).toBe(100);
  }));

  it('keeps the current page when rows are appended', fakeAsync(() => {
    const continuation = { environmentUrl: undefined } as QueryContinuation;
    const first = manyRows(60);
    emit({ status: 'rows', result: first, executionId: 1, continuation });
    expect(text()).toContain('60 rows loaded, more are available');

    const component = fixture.componentInstance;
    component.onPageChange({ pageIndex: 1, pageSize: component.pageSize, length: 60 });
    emit({ status: 'rows', result: first, executionId: 1, continuation, isLoadingMore: true });
    expect(component.pageIndex).toBe(1);

    emit({ status: 'rows', result: manyRows(120), executionId: 1 });

    expect(component.pageIndex).toBe(1);
    expect(component.totalRows).toBe(120);
    expect(text()).not.toContain('more are available');
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
