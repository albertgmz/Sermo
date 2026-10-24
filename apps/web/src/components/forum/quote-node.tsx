import {
  $applyNodeReplacement,
  $createParagraphNode,
  $isRootNode,
  DecoratorNode,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { JSX } from "react";
import { QuoteView } from "@/components/forum/quote-view";

// A quote in the editor: a fixed block that looks like the quote in a post. Its text cannot be
// edited and it goes whole (the × on it, or Backspace or Delete with it selected). It holds the BB
// code from its opening tag to its closing one, as it was written, and writes exactly that back.

type SerializedQuoteBlockNode = Spread<{ raw: string }, SerializedLexicalNode>;

export class QuoteBlockNode extends DecoratorNode<JSX.Element> {
  __raw: string;

  static getType() {
    return "quote-block";
  }

  static clone(node: QuoteBlockNode) {
    return new QuoteBlockNode(node.__raw, node.__key);
  }

  static importJSON(json: SerializedQuoteBlockNode) {
    return $createQuoteBlockNode(json.raw);
  }

  constructor(raw = "", key?: NodeKey) {
    super(key);
    this.__raw = raw;
  }

  exportJSON(): SerializedQuoteBlockNode {
    return { ...super.exportJSON(), raw: this.__raw };
  }

  createDOM() {
    return document.createElement("div");
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return false;
  }

  getRaw() {
    return this.getLatest().__raw;
  }

  getTextContent() {
    return this.getLatest().__raw;
  }

  decorate() {
    return <QuoteView nodeKey={this.__key} raw={this.__raw} />;
  }
}

export function $createQuoteBlockNode(raw: string) {
  return $applyNodeReplacement(new QuoteBlockNode(raw));
}

export function $isQuoteBlockNode(
  node: LexicalNode | null | undefined,
): node is QuoteBlockNode {
  return node instanceof QuoteBlockNode;
}

// Keeps a paragraph before a quote that comes first and after one that comes last, and one
// between two quotes, so that the caret can be put before and after each quote. The paragraphs
// are not written.
export function registerQuoteBlocks(editor: LexicalEditor) {
  return editor.registerNodeTransform(QuoteBlockNode, (node) => {
    if (!$isRootNode(node.getParent())) return;
    const before = node.getPreviousSibling();
    if (!before || $isQuoteBlockNode(before)) {
      node.insertBefore($createParagraphNode());
    }
    const after = node.getNextSibling();
    if (!after || $isQuoteBlockNode(after)) {
      node.insertAfter($createParagraphNode());
    }
  });
}
