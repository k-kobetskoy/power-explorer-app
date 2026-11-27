import { Injectable } from '@angular/core';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { SyntaxNode } from '@lezer/common';
import { QueryNodeTree } from '../../models/query-node-tree';
import { QueryNode } from '../../models/query-node';
import { QueryNodeData } from '../../models/constants/query-node-data';
import { ValueAttributeData } from '../../models/constants/attribute-data';
import { NodeTreeService } from '../node-tree.service';
import { NodeFactoryService } from '../attribute-services/node-factory.service';
import { QueryRenderService } from '../query-render.service';
import { NotificationService } from 'src/app/services/notification.service';

export const PARSER_NODE_NAMES = {
  document: 'Document',
  element: 'Element',
  openTag: 'OpenTag',
  closeTag: 'CloseTag',
  selfClosingTag: 'SelfClosingTag',
  tagName: 'TagName',
  attribute: 'Attribute',
  attributeName: 'AttributeName',
  attributeValue: 'AttributeValue',
  text: 'Text',
  entityReference: 'EntityReference',
  characterReference: 'CharacterReference',
  cdata: 'Cdata',
  mismatchedCloseTag: 'MismatchedCloseTag',
  missingCloseTag: 'MissingCloseTag',
};

/** Longest time Parse may spend finishing the editor's syntax tree before it gives up. */
const SYNTAX_TREE_TIMEOUT_MS = 2000;

const NAMED_ENTITIES: { [name: string]: string } = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: '\'',
};

export interface XmlParseResult {
  success: boolean;
  /** Reasons the text was rejected; empty on success. */
  errors: string[];
}

/** An element of the editor text, read from the syntax tree before any query node is created. */
interface ParsedElement {
  tagName: string;
  nodeName: string;
  attributes: { name: string, value: string }[];
  text: string;
  children: ParsedElement[];
}

/** Decodes the five predefined XML entities and numeric character references; anything else stays as is. */
export function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (reference, body: string) => {
    if (body[0] === '#') {
      const codePoint = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return reference;
      }
    }

    return NAMED_ENTITIES[body] ?? reference;
  });
}

@Injectable({ providedIn: 'root' })
export class XmlParseService {

  constructor(
    private nodeTreeService: NodeTreeService,
    private nodeFactory: NodeFactoryService,
    private queryRenderService: QueryRenderService,
    private notificationService: NotificationService
  ) { }

  /**
   * Replaces the query with the FetchXML in the editor, atomically. The text is checked and read first;
   * on a syntax error or an unknown tag nothing changes and the reason is shown. Otherwise the new tree
   * is built detached from the UI, swapped in with one nodeTree$ emission and rendered once
   * (the editor then shows the normalized XML).
   */
  parseXmlManually(view: EditorView): XmlParseResult {
    const errors: string[] = [];
    const parsedRoot = this.readDocument(view.state, errors);

    if (errors.length > 0 || !parsedRoot) {
      const message = errors.length > 1 ? `${errors[0]} (and ${errors.length - 1} more)` : errors[0];
      this.notificationService.showError(`Parse cancelled. ${message}`);
      return { success: false, errors };
    }

    const nodeTree = this.buildNodeTree(parsedRoot);

    this.nodeTreeService.replaceNodeTree(nodeTree);
    this.queryRenderService.renderXmlRequest();

    return { success: true, errors: [] };
  }

  private readDocument(state: EditorState, errors: string[]): ParsedElement | null {
    const tree = ensureSyntaxTree(state, state.doc.length, SYNTAX_TREE_TIMEOUT_MS);

    if (!tree) {
      errors.push('The text is too large to parse.');
      return null;
    }

    this.collectSyntaxErrors(state, tree.topNode, errors);

    const rootElements = tree.topNode.getChildren(PARSER_NODE_NAMES.element);

    if (rootElements.length === 0) {
      errors.push('There is no FetchXML to parse.');
      return null;
    }

    if (rootElements.length > 1) {
      errors.push(`${this.position(state, rootElements[1].from)}: only one root element is allowed.`);
    }

    const root = this.readElement(state, rootElements[0], errors);

    return errors.length > 0 ? null : root;
  }

  private collectSyntaxErrors(state: EditorState, topNode: SyntaxNode, errors: string[]): void {
    const cursor = topNode.cursor();

    do {
      const node = cursor.node;

      if (node.type.isError) {
        errors.push(`${this.position(state, node.from)}: syntax error.`);
      } else if (node.name === PARSER_NODE_NAMES.mismatchedCloseTag) {
        errors.push(`${this.position(state, node.from)}: closing tag ${state.sliceDoc(node.from, node.to)} does not match the open tag.`);
      } else if (node.name === PARSER_NODE_NAMES.missingCloseTag) {
        errors.push(`${this.position(state, node.from)}: missing closing tag.`);
      } else if (node.name === PARSER_NODE_NAMES.element) {
        const first = node.firstChild;
        const last = node.lastChild;

        if (first?.name === PARSER_NODE_NAMES.openTag && last?.name !== PARSER_NODE_NAMES.closeTag
          && last?.name !== PARSER_NODE_NAMES.mismatchedCloseTag && last?.name !== PARSER_NODE_NAMES.missingCloseTag) {
          errors.push(`${this.position(state, node.from)}: missing closing tag.`);
        }
      }
    } while (cursor.next());
  }

  private readElement(state: EditorState, element: SyntaxNode, errors: string[]): ParsedElement | null {
    const tag = element.firstChild;
    const tagNameNode = tag?.getChild(PARSER_NODE_NAMES.tagName);

    if (!tagNameNode) {
      errors.push(`${this.position(state, element.from)}: missing tag name.`);
      return null;
    }

    const tagName = state.sliceDoc(tagNameNode.from, tagNameNode.to);

    if (!QueryNodeData.TagNames.includes(tagName)) {
      errors.push(`${this.position(state, tagNameNode.from)}: unknown tag <${tagName}>.`);
      return null;
    }

    const parsed: ParsedElement = {
      tagName,
      nodeName: QueryNodeData.TagNamesToNodeNames[tagName],
      attributes: [],
      text: '',
      children: []
    };

    for (const attribute of tag.getChildren(PARSER_NODE_NAMES.attribute)) {
      const nameNode = attribute.getChild(PARSER_NODE_NAMES.attributeName);
      const valueNode = attribute.getChild(PARSER_NODE_NAMES.attributeValue);

      if (!nameNode || !valueNode) {
        errors.push(`${this.position(state, attribute.from)}: attribute without a value.`);
        continue;
      }

      parsed.attributes.push({
        name: state.sliceDoc(nameNode.from, nameNode.to).toLowerCase(),
        value: decodeXmlEntities(this.removeQuotes(state.sliceDoc(valueNode.from, valueNode.to)))
      });
    }

    let text = '';

    for (let child = tag.nextSibling; child; child = child.nextSibling) {
      switch (child.name) {
        case PARSER_NODE_NAMES.element: {
          const parsedChild = this.readElement(state, child, errors);
          if (parsedChild) {
            parsed.children.push(parsedChild);
          }
          break;
        }
        case PARSER_NODE_NAMES.text:
          text += state.sliceDoc(child.from, child.to);
          break;
        case PARSER_NODE_NAMES.entityReference:
        case PARSER_NODE_NAMES.characterReference:
          text += decodeXmlEntities(state.sliceDoc(child.from, child.to));
          break;
        case PARSER_NODE_NAMES.cdata:
          text += state.sliceDoc(child.from, child.to).replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
          break;
      }
    }

    // Text is only meaningful inside <value>; elsewhere it is ignored, as before (the linter reports it)
    parsed.text = text.trim();

    return parsed;
  }

  /**
   * Builds the query nodes with the usual factories, detached from the UI: no nodeTree$ emission,
   * no selection change, no events. Children are stably sorted by node order, which is the order
   * NodeTreeService.getNodeAbove gives when nodes are added one by one in document order.
   */
  private buildNodeTree(parsedRoot: ParsedElement): QueryNodeTree {
    const nodeTree = new QueryNodeTree();
    const root = this.nodeFactory.createNode(parsedRoot.nodeName, true, null);
    nodeTree.root = root;

    let last = root;
    this.addAttributes(root, parsedRoot);

    const appendChildren = (parentNode: QueryNode, parsedParent: ParsedElement) => {
      const children = [...parsedParent.children]
        .sort((a, b) => QueryNodeData.getNodeData(a.nodeName).Order - QueryNodeData.getNodeData(b.nodeName).Order);

      for (const parsedChild of children) {
        const node = this.nodeFactory.createNode(parsedChild.nodeName, true, root);
        node.level = parentNode.level + 1;
        node.parent = parentNode;
        parentNode.expandable = true;

        last.next = node;
        last = node;

        this.addAttributes(node, parsedChild);
        appendChildren(node, parsedChild);
      }
    };

    appendChildren(root, parsedRoot);

    return nodeTree;
  }

  private addAttributes(node: QueryNode, parsed: ParsedElement): void {
    const attributeFactory = this.nodeFactory.getAttributesFactory(parsed.nodeName);

    for (const attribute of parsed.attributes) {
      node.addAttribute(attributeFactory.createAttribute(attribute.name, node, true, attribute.value));
    }

    if (parsed.nodeName === QueryNodeData.Value.NodeName && parsed.text) {
      node.addAttribute(attributeFactory.createAttribute(ValueAttributeData.InnerText.EditorName, node, true, parsed.text));
    }
  }

  private position(state: EditorState, offset: number): string {
    return `Line ${state.doc.lineAt(offset).number}`;
  }

  private removeQuotes(str: string): string {
    if (str.length >= 2 && (str[0] === '"' || str[0] === '\'') && str[str.length - 1] === str[0]) {
      return str.slice(1, -1);
    }
    return str;
  }
}
