import { Component, EventEmitter, OnInit, Output, OnDestroy, ViewEncapsulation, ChangeDetectionStrategy, ChangeDetectorRef, Inject, ElementRef, ViewChild } from '@angular/core';
import {  Subscription, takeUntil, tap, Subject, BehaviorSubject } from 'rxjs';
import { ExecutionState, MatTableRawData, QueryContinuation, XmlExecutorService } from '../services/xml-executor.service';
import { DEFAULT_PAGE_SIZE_OPTIONS, FALLBACK_PAGE_SIZE, PageSizePreference, fitPageSize } from './page-size';
import { MatButtonModule } from '@angular/material/button';
import { NodeTreeService } from '../services/node-tree.service';
import { QueryNode } from '../models/query-node';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatTableModule } from '@angular/material/table';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ExternalLinkService } from '../../../services/external-link.service';
import { EnvironmentModel } from 'src/app/models/environment-model';
import { ACTIVE_ENVIRONMENT_MODEL } from 'src/app/models/tokens';
import { RawResultPanelComponent } from '../../raw-result-panel/raw-result-panel.component';
import { AngularSplitModule } from 'angular-split';

@Component({
    selector: 'app-result-table',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatSlideToggleModule,
        MatTableModule,
        MatProgressBarModule,
        MatIconModule,
        MatPaginatorModule,
        MatButtonModule,
        RawResultPanelComponent,
        AngularSplitModule,
    ],
    templateUrl: './result-table.component.html',
    styleUrls: ['./result-table.component.css'],
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResultTableComponent implements OnInit, OnDestroy {
  closedPanel = true;
  
  selectedRow: any;
  selectedOverflowCell: any;
  selectedColumn: string | null = null;

  showFormattedValues = true; // Toggle for formatted/raw values

  displayedColumns: string[] = [];
  dataSource: any[] = [];
  
  // Pagination properties
  paginatedData: any[] = [];
  pageSize = FALLBACK_PAGE_SIZE;
  pageSizeOptions: number[] = [...DEFAULT_PAGE_SIZE_OPTIONS];
  pageIndex = 0;
  totalRows = 0;

  // Store the complete result data
  resultData: MatTableRawData | null = null;
  
  // BehaviorSubject for raw result panel
  dataSourceSubject = new BehaviorSubject<any>(null);
  rawDataverseResult = new BehaviorSubject<any>(null);
  formattedDataverseResult = new BehaviorSubject<any>(null);
  
  isLoading = false;
  hasError = false;
  errorMessage = '';

  // Set while Dataverse has more rows than the table holds
  continuation: QueryContinuation | null = null;
  isLoadingMore = false;
  private executionId: number | undefined;

  @ViewChild('tableScroll') private tableScroll: ElementRef<HTMLElement>;

  // Track current environment URL
  private currentEnvironmentUrl: string = '';
  private environmentSubscription: Subscription;

  // Add destroy$ Subject
  private destroy$ = new Subject<void>();
  
  constructor(
    private xmlExecutor: XmlExecutorService,
    private nodeTreeService: NodeTreeService,
    private cdr: ChangeDetectorRef,
    private externalLinkService: ExternalLinkService,
    private pageSizePreference: PageSizePreference,
    @Inject(ACTIVE_ENVIRONMENT_MODEL) private activeEnvironmentModel: BehaviorSubject<EnvironmentModel>
  ) {
    this.destroy$ = new Subject<void>();
  }
  @Output() resultTableGetResult = new EventEmitter<void>();

  ngOnInit() {

    this.rawDataverseResult = this.xmlExecutor.getRawDataverseRawResult();
    
    this.rawDataverseResult
      .pipe(takeUntil(this.destroy$))
      .subscribe(result => this.dataSourceSubject.next(result));

    // The table is drawn from the execution state only
    this.xmlExecutor.state$
      .pipe(takeUntil(this.destroy$))
      .subscribe(state => this.applyState(state));

    // Subscribe to environment changes for URL building
    this.environmentSubscription = this.activeEnvironmentModel
      .pipe(takeUntil(this.destroy$))
      .subscribe(env => {
        if (env && env.apiUrl) {
          // Convert API URL to web client URL
          this.currentEnvironmentUrl = env.url.replace('.api.', '.');

          // Clean up URL format
          if (this.currentEnvironmentUrl.endsWith('/api/data/v9.2/')) {
            this.currentEnvironmentUrl = this.currentEnvironmentUrl.replace('/api/data/v9.2/', '/');
          } else if (this.currentEnvironmentUrl.endsWith('/api/data/v9.1/')) {
            this.currentEnvironmentUrl = this.currentEnvironmentUrl.replace('/api/data/v9.1/', '/');
          } else if (this.currentEnvironmentUrl.endsWith('/api/data/v9.0/')) {
            this.currentEnvironmentUrl = this.currentEnvironmentUrl.replace('/api/data/v9.0/', '/');
          }

          // Ensure URL ends with slash
          if (!this.currentEnvironmentUrl.endsWith('/')) {
            this.currentEnvironmentUrl += '/';
          }
          
          // If we already have results, refresh data source to update URLs
          if (this.resultData && this.resultData.rows?.length > 0) {
            this.refreshDataSource();
          }
        }
        // whether more rows can be loaded depends on the active environment
        this.cdr.markForCheck();
      });
  }

  ngOnDestroy() {
    if (this.environmentSubscription) {
      this.environmentSubscription.unsubscribe();
    }
    // Complete the destroy$ Subject
    this.destroy$.next();
    this.destroy$.complete();
  }

  getResult() {
    // Check if we have a stored result already
    if (this.resultData && this.resultData.rows && this.resultData.rows.length > 0) {
      this.processResultData();
      this.cdr.markForCheck();
      return;
    }

    // Emit the event for parent components to handle
    this.resultTableGetResult.emit();

    this.executeWithData(this.nodeTreeService.xmlRequest$.value, this.getEntityNode());
  }

  private applyState(state: ExecutionState) {
    this.isLoading = state.status === 'loading';
    this.hasError = state.status === 'requestError' || state.status === 'processingError';
    this.errorMessage = state.status === 'requestError' || state.status === 'processingError' ? state.message : '';

    if (state.status === 'rows') {
      this.continuation = state.continuation ?? null;
      this.isLoadingMore = !!state.isLoadingMore;
      if (state.loadMoreError) {
        this.hasError = true;
        this.errorMessage = state.loadMoreError.message;
      }

      // further states of the same execution keep the page the user is on
      const isSameExecution = state.executionId !== undefined && state.executionId === this.executionId;
      if (!isSameExecution || state.result !== this.resultData) {
        this.executionId = state.executionId;
        this.resultData = state.result;
        this.processResultData(isSameExecution);
      }
    } else {
      this.clearResult();
      if (state.status === 'idle') {
        this.displayedColumns = ['No results available'];
      } else if (state.status === 'empty') {
        this.displayedColumns = ['No results'];
      }
    }

    this.cdr.markForCheck();
  }

  get canLoadMore(): boolean {
    return this.activeEnvironmentModel.value?.url === this.continuation?.environmentUrl;
  }

  loadMore() {
    this.xmlExecutor.loadMore();
  }

  private clearResult() {
    this.continuation = null;
    this.isLoadingMore = false;
    this.resultData = null;
    this.selectedRow = null;
    this.selectedOverflowCell = null;
    this.selectedColumn = null;
    this.displayedColumns = [];
    this.dataSource = [];
    this.paginatedData = [];
    this.totalRows = 0;
    this.pageIndex = 0;
    this.formattedDataverseResult.next(null);
  }

  private processResultData(keepPage = false) {
    if (!this.resultData) {
      this.displayedColumns = ['No data'];
      this.dataSource = [];
      this.cdr.markForCheck();
      return;
    }

   // this.dataSourceSubject.next(this.resultData);
    // Reset cell selection when new data is loaded
    this.selectedOverflowCell = null;
    this.selectedColumn = null;
    this.selectedRow = null;
    this.formattedDataverseResult.next(this.resultData.rows);
    // Get all columns from header but exclude __entity_url
    // This will include columns with null values after our processing strategy has run
    const headerColumns = Object.keys(this.resultData.header || {}).filter(col => col !== '__entity_url');
    
    // Sort columns to ensure consistent display order
    // First attempt to put ID fields at the beginning
    headerColumns.sort((a, b) => {
      // Put ID fields first
      const aIsId = a.toLowerCase().endsWith('id') || a.toLowerCase() === 'id';
      const bIsId = b.toLowerCase().endsWith('id') || b.toLowerCase() === 'id';
      
      if (aIsId && !bIsId) return -1;
      if (!aIsId && bIsId) return 1;
      
      // Then sort alphabetically
      return a.localeCompare(b);
    });
    
    // Add the __entity_url column to the end if it exists in the data
    const hasEntityUrl = this.resultData.rows?.length > 0 && 
                        this.resultData.rows[0].attributes.has('__entity_url');
    
    if (hasEntityUrl) {
      this.displayedColumns = ['No.', ...headerColumns, '__entity_url'];
    } else {
      this.displayedColumns = ['No.', ...headerColumns];
    }

    if (!keepPage && this.pageSizePreference.userPageSize) {
      this.setPageSize(this.pageSizePreference.userPageSize);
    }

    // Set the data source based on the toggle state
    this.refreshDataSource(keepPage);

    // Force change detection immediately
    this.cdr.markForCheck();
    this.cdr.detectChanges();
    
    // Force an update on the next tick to ensure Angular has processed the changes
    setTimeout(() => {
      this.cdr.markForCheck();
      this.cdr.detectChanges();
      // the table is on screen now and can be measured
      if (!keepPage) {
        this.fitPageSizeToTable();
      }
    }, 0);
  }

  private fitPageSizeToTable() {
    const container = this.tableScroll?.nativeElement;
    const row = container?.querySelector('tr.mat-mdc-row');

    if (!row || this.pageSizePreference.userPageSize) {
      return;
    }

    const headerHeight = container.querySelector('tr.mat-mdc-header-row')?.getBoundingClientRect().height ?? 0;
    // clientHeight leaves out a horizontal scrollbar; 0 means the panel is not shown
    const rowsAreaHeight = container.clientHeight ? Math.max(1, container.clientHeight - headerHeight) : 0;

    this.setPageSize(fitPageSize(rowsAreaHeight, row.getBoundingClientRect().height));
    this.updatePaginatedData();
    this.cdr.detectChanges();
  }

  private setPageSize(pageSize: number) {
    this.pageSize = pageSize;
    // mat-paginator shows an empty selection for a size that is not among the options
    this.pageSizeOptions = [...new Set([...DEFAULT_PAGE_SIZE_OPTIONS, pageSize])].sort((a, b) => a - b);
  }

  private getEntityNode(): QueryNode {
    return this.nodeTreeService.getNodeTree().value.root.next;
  }

  selectRow(row: any) {
    // If clicking on the same row as previously selected, deselect it
    if (this.selectedRow === row) {
      this.selectedRow = null;
      this.dataSourceSubject.next(this.rawDataverseResult.value);
    } else {
      this.selectedRow = row;
      this.dataSourceSubject.next(this.formattedDataverseResult.value[row['No.'] - 1]['rowJson']);
    }
  }

  selectCell(element: Object, event: MouseEvent) {
    const cell = event.target as HTMLElement;
    const td = cell.closest('td');
    
    if (!td) return;
    
    // Get the column index
    const columnIndex = Array.from(td.parentElement?.children || []).indexOf(td);
    if (columnIndex < 0) return;
    
    // Get the column name
    const columnName = this.displayedColumns[columnIndex];
    
    // If clicking on the same cell as previously selected, toggle it off
    if (this.selectedOverflowCell === element && this.selectedColumn === columnName) {
      this.selectedOverflowCell = null;
      this.selectedColumn = null;
    } else {
      // Otherwise, select this cell
      this.selectedOverflowCell = element;
      this.selectedColumn = columnName;
    }
    
    // Force Angular to detect changes
    this.cdr.detectChanges();
  }

  isTextHidden(cell: HTMLElement): boolean {
    return cell.scrollWidth > cell.clientWidth;
  }

  getFieldType(columnName: string): string {
    if (!this.resultData || !this.resultData.header || columnName === 'No.') {
      return columnName === 'No.' ? 'number' : 'string';
    }

    const fieldInfo = this.resultData.header[columnName];
    if (!fieldInfo) return 'string';

    // Check for lookup fields by name pattern (_*_value)
    if (columnName.includes('_value') || (fieldInfo.type && fieldInfo.type.toLowerCase() === 'lookup')) {
      return 'lookup';
    }

    // Check if this column contains GUIDs in raw data
    if (this.hasGuidValues(columnName)) {
      return 'uniqueidentifier';
    }

    // Convert field types from the header to our internal types
    switch (fieldInfo.type?.toLowerCase()) {
      case 'money':
      case 'decimal':
      case 'double':
      case 'integer':
        return 'number';
      case 'datetime':
        return 'datetime';
      case 'lookup':
        return 'lookup';
      case 'boolean':
        return 'boolean';
      case 'uniqueidentifier':
        return 'uniqueidentifier';
      case 'picklist':
      case 'state':
      case 'status':
        return 'picklist';
      case 'dynamicslink':
        return 'dynamicslink';
      default:
        return 'string';
    }
  }

  // Helper method to check if a column contains GUID values
  private hasGuidValues(columnName: string): boolean {
    if (!this.resultData || !this.resultData.rows || this.resultData.rows.length === 0) {
      return false;
    }
    
    // Regular expression for GUID validation
    const guidRegEx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    // Check the first few rows to see if they contain GUID values
    const sampleSize = Math.min(5, this.resultData.rows.length);
    let guidCount = 0;
    
    for (let i = 0; i < sampleSize; i++) {
      const row = this.resultData.rows[i];
      if (row && row.attributes.has(columnName)) {
        const cellData = row.attributes.get(columnName);
        if (cellData && typeof cellData.attributeRawValue === 'string' && 
            guidRegEx.test(cellData.attributeRawValue)) {
          guidCount++;
        }
      }
    }
    
    // If more than half of the sampled rows contain GUIDs, consider it a GUID column
    return guidCount > sampleSize / 2;
  }

  getCellClass(columnName: string): string {
    if (columnName === 'No.') return 'number-cell';

    const type = this.getFieldType(columnName);

    switch (type.toLowerCase()) {
      case 'string':
      case 'memo':
        return 'text-cell';
      case 'number':
        return 'number-cell';
      case 'boolean':
        return 'boolean-cell';
      case 'datetime':
        return 'date-cell';
      case 'lookup':
        return 'lookup-cell';
      case 'uniqueidentifier':
        return 'uniqueidentifier-cell';
      case 'picklist':
        return 'picklist-cell';
      case 'dynamicslink':
        return 'link-cell';
      default:
        return 'text-cell'; // Default styling
    }
  }

  getColumnDisplayName(columnName: string): string {
    if (columnName === 'No.') return 'No.';

    // Always show "View in Dynamics" for the entity URL column in both views
    if (columnName === '__entity_url') return 'View in Dynamics';

    if (!this.resultData || !this.resultData.header) {
      return columnName;
    }

    const fieldInfo = this.resultData.header[columnName];
    if (!fieldInfo) {
      return columnName;
    }

    // If we're showing formatted values, return the displayName, otherwise return the logical name
    if (this.showFormattedValues) {
      return fieldInfo.displayName || columnName;
    } else {
      // For technical values view, show the logical name
      return fieldInfo.logicalName || columnName;
    }
  }

  formatCellValue(row: any, columnName: string): string {
    if (!this.resultData || !row) {
      return row ? row[columnName]?.toString() || '' : '';
    }

    // For attributes in the new format
    if (row.attributes && row.attributes.has(columnName)) {
      const cellData = row.attributes.get(columnName);
      
      // Handle null or undefined values
      if (!cellData || cellData.attributeRawValue === null || cellData.attributeRawValue === undefined) {
        return '';
      }
      
      // Handle link display
      if (cellData.link) {
        return '🔗 ' + (cellData.attributeFormattedValue || cellData.attributeRawValue);
      }
      
      // Return formatted or raw value based on toggle
      return this.showFormattedValues && cellData.attributeFormattedValue ? 
        cellData.attributeFormattedValue : cellData.attributeRawValue.toString();
    }
    
    // Fallback for direct access
    return row[columnName]?.toString() || '';
  }

  hasFormattedValue(row: any, columnName: string): boolean {
    if (!this.resultData || columnName === 'No.' || !row.attributes) {
      return false;
    }
    
    if (row.attributes.has(columnName)) {
      const cellData = row.attributes.get(columnName);
      return !!(cellData && cellData.attributeFormattedValue && 
                cellData.attributeFormattedValue !== cellData.attributeRawValue);
    }
    
    return false;
  }

  toggleValueFormat() {
    // Store the currently selected row before toggling
    const currentSelectedRow = this.selectedRow ? { ...this.selectedRow } : null;

    this.showFormattedValues = !this.showFormattedValues;

    // Reset cell selection when toggling format
    this.selectedOverflowCell = null;
    this.selectedColumn = null;

    // Refresh the data source with the new format
    this.refreshDataSource();

    // Restore the selected row if possible
    if (currentSelectedRow && this.dataSource.length > 0) {
      const rowIndex = currentSelectedRow['No.'] - 1;
      if (rowIndex >= 0 && rowIndex < this.dataSource.length) {
        this.selectedRow = this.dataSource[rowIndex];
      }
    }
  }

  private refreshDataSource(keepPage = false) {
    if (!this.resultData || !this.resultData.rows) {
      this.dataSource = [];
      this.paginatedData = [];
      this.totalRows = 0;
      this.cdr.markForCheck();
      return;
    }

    try {
      // Check if rows have the expected structure
      if (this.resultData.rows.length > 0) {
        const firstRow = this.resultData.rows[0];
       
      }

      // Convert RowData to data source format
      this.dataSource = this.resultData.rows.map((rowData, index) => {
        // Create object with row number
        const newItem: any = { 'No.': index + 1 };
        
        // Add reference to original row data
        newItem['__rowData'] = rowData;
        
        // Add all header columns
        for (const columnName of Object.keys(this.resultData.header)) {
          // Check if attributes is a Map and has the column
          if (rowData.attributes && rowData.attributes instanceof Map && rowData.attributes.has(columnName)) {
            newItem[columnName] = rowData.attributes.get(columnName);
          } else if (rowData.attributes && !(rowData.attributes instanceof Map) && rowData.attributes[columnName]) {
            // If attributes is not a Map but an object, handle it differently
            newItem[columnName] = {
              attributeLogicalName: columnName,
              attributeRawValue: rowData.attributes[columnName]
            };
          } else {
            // Create empty cell for missing columns
            newItem[columnName] = {
              attributeLogicalName: columnName,
              attributeRawValue: '',
            };
          }
        }
        
        // Add dataverse link if available
        if (rowData.dataverseRowLink) {
          newItem['__entity_url'] = {
            url: rowData.dataverseRowLink,
            text: '🔗',
            isRawView: !this.showFormattedValues
          };
        }
        
              
        return newItem;
      });
      
      // Update total rows
      this.totalRows = this.dataSource.length;
      
      // Reset to first page when data source changes, unless rows were only appended
      if (!keepPage) {
        this.pageIndex = 0;
      }
      
      // Update paginated view
      this.updatePaginatedData();
      
            
    } catch (error) {
      console.error('Error refreshing data source:', error);
      this.dataSource = [];
      this.paginatedData = [];
      this.totalRows = 0;
      this.cdr.markForCheck();
    }
  }

  // Handle page events from the paginator
  onPageChange(event: PageEvent) {
    // a size picked by the user wins over the fitted one
    if (event.pageSize !== this.pageSize) {
      this.pageSizePreference.userPageSize = event.pageSize;
    }
    this.pageSize = event.pageSize;
    this.pageIndex = event.pageIndex;
    
    // Reset cell selection on page change
    this.selectedOverflowCell = null;
    this.selectedColumn = null;
    
    this.updatePaginatedData();
    this.cdr.detectChanges();
  }
  
  // Update the paginated data based on the current page and page size
  private updatePaginatedData() {
    const startIndex = this.pageIndex * this.pageSize;
    const endIndex = startIndex + this.pageSize;
    
    this.paginatedData = this.dataSource.slice(startIndex, endIndex);
    this.cdr.markForCheck();
  }

  executeWithData(xml: string, entityNode: QueryNode) {
    this.xmlExecutor.execute(xml, entityNode);
  }

  togglePanel() {
    this.closedPanel = !this.closedPanel;
  }

  // Add a method to handle external link clicks
  openExternalLink(url: string): void {
    if (url) {
      this.externalLinkService.openExternalLink(url);
    }
  }
}