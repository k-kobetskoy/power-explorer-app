import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { ControlPanelComponent } from './control-panel.component';
import { RootFormComponent } from './query-forms/root-form/root-form.component';
import { XmlParseService } from '../services/xml-parsing-services/xml-parse.service';
import { QueryRenderService } from '../services/query-render.service';
import { NodeTreeService } from '../services/node-tree.service';
import { provideQueryBuilderTesting } from '../services/query-builder-test-providers';

describe('ControlPanelComponent after Parse', () => {
  let fixture: ComponentFixture<ControlPanelComponent>;
  let view: EditorView;

  function parse(text: string): void {
    view?.destroy();
    view = new EditorView({ state: EditorState.create({ doc: text, extensions: [xml()] }) });
    expect(TestBed.inject(XmlParseService).parseXmlManually(view).success).toBeTrue();
    tick(50);
    fixture.detectChanges();
  }

  function rootForm(): RootFormComponent {
    return fixture.debugElement.query(By.directive(RootFormComponent)).componentInstance;
  }

  function formValues() {
    const form = rootForm();
    return {
      top: form.topFormControl.value,
      page: form.pageFormControl.value,
      distinct: form.distinctFormControl.value,
      aggregate: form.aggregateFormControl.value,
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ControlPanelComponent],
      providers: [...provideQueryBuilderTesting(), provideNoopAnimations()]
    });
    TestBed.inject(NodeTreeService);
    TestBed.inject(QueryRenderService);
    fixture = TestBed.createComponent(ControlPanelComponent);
    fixture.detectChanges();
  });

  afterEach(() => view?.destroy());

  it('shows the values of the new root node, not those of the previous query', fakeAsync(() => {
    parse('<fetch top="77" distinct="true" aggregate="true" page="3">\n  <entity name="account" />\n</fetch>');
    expect(formValues()).toEqual({ top: '77', page: '3', distinct: true, aggregate: true });

    parse('<fetch>\n  <entity name="account" />\n</fetch>');
    expect(formValues()).toEqual({ top: '', page: '', distinct: false, aggregate: false });

    const inputs: HTMLInputElement[] = Array.from(fixture.nativeElement.querySelectorAll('input[type="number"]'));
    expect(inputs.map(input => input.value)).toEqual(['', '', '']);

    fixture.destroy();
    flush();
  }));

  it('keeps the same form while the selected root node stays the same', fakeAsync(() => {
    parse('<fetch top="5">\n  <entity name="account" />\n</fetch>');
    const before = rootForm();

    fixture.detectChanges();

    expect(rootForm()).toBe(before);
    fixture.destroy();
    flush();
  }));
});
