import { TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { xml } from '@codemirror/lang-xml';
import { XmlParseService } from './xml-parse.service';
import { NodeTreeService } from '../node-tree.service';
import { QueryRenderService } from '../query-render.service';
import { provideQueryBuilderTesting } from '../query-builder-test-providers';

/**
 * Builds a FetchXML query with roughly `targetNodes` nodes, written in the canonical child order
 * the tree produces (order, attribute, link-entity, filter), so a round trip must return it unchanged.
 */
export function generateFetchXml(targetNodes: number): { text: string, nodeCount: number } {
  const lines: string[] = ['<fetch top="50">', '  <entity name="account">'];
  let nodeCount = 2;
  let i = 0;

  // Each link-entity block adds 7 nodes: link-entity, 2 attributes, filter, condition, 2 values.
  while (nodeCount + 7 <= targetNodes - 2) {
    lines.push(
      `    <link-entity name="contact" from="parentcustomerid" to="accountid" alias="c${i}">`,
      `      <attribute name="fullname" />`,
      `      <attribute name="emailaddress1" alias="mail${i}" />`,
      `      <filter type="or">`,
      `        <condition attribute="statecode" operator="in">`,
      `          <value>${i}</value>`,
      `          <value>${i + 1}</value>`,
      `        </condition>`,
      `      </filter>`,
      `    </link-entity>`,
    );
    nodeCount += 7;
    i++;
  }

  lines.push('    <filter type="and">');
  nodeCount++;
  while (nodeCount < targetNodes) {
    lines.push(`      <condition attribute="name" operator="like" value="a${nodeCount}%" />`);
    nodeCount++;
  }
  lines.push('    </filter>', '  </entity>', '</fetch>');

  return { text: lines.join('\n'), nodeCount };
}

describe('Parse / render benchmark', () => {
  let parseService: XmlParseService;
  let nodeTreeService: NodeTreeService;
  let renderService: QueryRenderService;
  let view: EditorView;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: provideQueryBuilderTesting() });
    parseService = TestBed.inject(XmlParseService);
    nodeTreeService = TestBed.inject(NodeTreeService);
    renderService = TestBed.inject(QueryRenderService);
  });

  afterEach(() => view?.destroy());

  function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  const RUNS = 5;

  for (const size of [50, 200, 1000]) {
    it(`parses and renders ${size} nodes; one tree and one XML emission per Parse`, fakeAsync(() => {
      const { text, nodeCount } = generateFetchXml(size);
      const parseTimes: number[] = [];
      const renderTimes: number[] = [];
      const treeEmissions: number[] = [];
      const xmlEmissions: number[] = [];
      let rendered = '';

      for (let run = 0; run < RUNS; run++) {
        view?.destroy();
        view = new EditorView({ state: EditorState.create({ doc: text, extensions: [xml()] }) });
        tick(50);

        let treeCount = 0;
        let xmlCount = 0;
        const treeSub = nodeTreeService.getNodeTree().subscribe(() => treeCount++);
        const xmlSub = nodeTreeService.xmlRequest$.subscribe(() => xmlCount++);
        treeCount = 0;
        xmlCount = 0;

        // Parse includes finishing the syntax tree of the editor text, building the nodes and the first render
        const parseStart = performance.now();
        parseService.parseXmlManually(view);
        tick(50);
        parseTimes.push(performance.now() - parseStart);

        treeEmissions.push(treeCount);
        xmlEmissions.push(xmlCount);
        rendered = nodeTreeService.xmlRequest$.value;

        const renderStart = performance.now();
        renderService.renderXmlRequest();
        tick(50);
        renderTimes.push(performance.now() - renderStart);

        flush();
        treeSub.unsubscribe();
        xmlSub.unsubscribe();
      }

      const parsedNodes = [...nodeTreeService.getNodeTree().value].length;

      console.log(`[benchmark] nodes=${nodeCount} runs=${RUNS} parse median=${median(parseTimes).toFixed(1)}ms ` +
        `render median=${median(renderTimes).toFixed(1)}ms ` +
        `nodeTree$ emissions per Parse=${treeEmissions.join('/')} xmlRequest$ emissions per Parse=${xmlEmissions.join('/')}`);

      expect(parsedNodes).toBe(nodeCount);
      expect(rendered).toBe(text);
      expect(treeEmissions.every(count => count === 1)).toBeTrue();
      expect(xmlEmissions.every(count => count === 1)).toBeTrue();
    }));
  }
});
