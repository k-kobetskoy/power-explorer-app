import { Injectable, OnDestroy } from '@angular/core';
import { Subject, debounceTime, takeUntil } from 'rxjs';
import { NodeTreeService } from './node-tree.service';
import { QueryNode } from '../models/query-node';
import { ValueAttributeData } from '../models/constants/attribute-data';
import { escapeXmlText } from '../models/attribute-display-values';

/**
 * Renders the node tree as FetchXML text. Pure: reads the current attribute values, no subscriptions.
 * Two-space indent; a node without children is self-closing (` />`); a value node with a text
 * attribute renders as `<value>text</value>`; attributes with an empty value are omitted.
 */
export function renderFetchXml(root: QueryNode): string {
  const lines: string[] = [];
  const openNodes: QueryNode[] = [];

  for (let node = root; node; node = node.next) {
    while (openNodes.length > 0 && openNodes[openNodes.length - 1].level >= node.level) {
      lines.push(renderClosingTag(openNodes.pop()));
    }

    const indent = getIndent(node.level);
    const attributes = renderAttributes(node);
    const openTag = attributes ? `${indent}<${node.tagName} ${attributes}` : `${indent}<${node.tagName}`;
    const textAttribute = node.tagName === 'value'
      ? node.attributes$.value.find(attr => attr.editorName === ValueAttributeData.InnerText.EditorName)
      : undefined;
    const hasChildren = !!node.next && node.next.level > node.level;

    if (textAttribute) {
      const text = textAttribute.value$.value ? escapeXmlText(textAttribute.value$.value) : '';
      lines.push(`${openTag}>${text}</${node.tagName}>`);
    } else if (hasChildren) {
      lines.push(`${openTag}>`);
      openNodes.push(node);
    } else {
      lines.push(`${openTag} />`);
    }
  }

  while (openNodes.length > 0) {
    lines.push(renderClosingTag(openNodes.pop()));
  }

  return lines.join('\n');
}

function renderAttributes(node: QueryNode): string {
  return node.attributes$.value
    // The inner text of a value node is rendered as element text, not as an attribute
    .filter(attr => !(node.tagName === 'value' && attr.editorName === ValueAttributeData.InnerText.EditorName))
    .map(attr => attr.attributeDisplayValues.getEditorViewDisplayValueFor(attr.value$.value))
    .filter(value => value !== '')
    .join(' ');
}

function renderClosingTag(node: QueryNode): string {
  return `${getIndent(node.level)}</${node.tagName}>`;
}

function getIndent(level: number): string {
  return '  '.repeat(level);
}

@Injectable({ providedIn: 'root' })
export class QueryRenderService implements OnDestroy {
  private destroy$ = new Subject<void>();

  constructor(private nodeTreeService: NodeTreeService) {
    // One subscription for the lifetime of the service: re-render after any change of the tree,
    // smoothed so that a burst of changes (e.g. a form filling several attributes) renders once.
    this.nodeTreeService.treeChanged$.pipe(
      debounceTime(30),
      takeUntil(this.destroy$)
    ).subscribe(() => this.renderIfChanged());
  }

  /** Renders the current tree, publishes it to xmlRequest$ (always, so the editor is refreshed) and returns it. */
  renderXmlRequest(): string {
    const xml = this.renderCurrentTree();
    this.nodeTreeService.xmlRequest$.next(xml);
    return xml;
  }

  private renderIfChanged(): void {
    const xml = this.renderCurrentTree();

    if (xml !== this.nodeTreeService.xmlRequest$.value) {
      this.nodeTreeService.xmlRequest$.next(xml);
    }
  }

  private renderCurrentTree(): string {
    const root = this.nodeTreeService.getNodeTree().value?.root;
    return root ? renderFetchXml(root) : '';
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
