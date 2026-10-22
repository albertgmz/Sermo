import { $isCodeNode } from "@lexical/code";
import {
  $addUpdateTag,
  $applyNodeReplacement,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  DecoratorNode,
  HISTORY_MERGE_TAG,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { JSX } from "react";
import { placeFile } from "@/components/forum/composer-insert";
import { ImageView } from "@/components/forum/image-view";

// A picture attached to the text, shown in the editor as the picture and written as XenForo writes
// it: `[ATTACH=full]12[/ATTACH]`, or with the size and alt text the member gave it,
// `[ATTACH type="full" width="300px" alt="…"]12[/ATTACH]`. A pasted or dropped picture is in the
// text at once, while it uploads; it is written only once the upload has given it an id.

// Pictures on their way up, by the key the editor gave each: what shows meanwhile (the file read as
// a `data:` address, as the site's img-src policy allows no `blob:` picture) and how the upload
// ended. The copy of the file goes as soon as the upload ends, and the entries of an editor when it
// is done (`forgetUploads`); a stored id is written into the pictures themselves too.
type Upload = { preview?: string; id?: number; failed?: true };
const uploads = new Map<string, Upload>();
const started = new WeakMap<LexicalEditor, Set<string>>();
let made = 0;

export function startUpload(): string {
  made += 1;
  const key = `${Date.now().toString(36)}-${made}`;
  uploads.set(key, {});
  return key;
}

export const uploadOf = (key: string | null) =>
  key === null ? undefined : uploads.get(key);

// How the upload of `key` ended: the id it was stored under, or none for a refusal.
export function settleUpload(key: string, id?: number) {
  const upload = uploads.get(key);
  if (!upload) return;
  upload.preview = undefined;
  if (id) upload.id = id;
  else upload.failed = true;
}

// Lets go of the uploads `editor` started: it is gone, or its form was sent and starts over.
export function forgetUploads(editor: LexicalEditor) {
  for (const key of started.get(editor) ?? []) uploads.delete(key);
  started.delete(editor);
}

export function showPreview(key: string, preview: string) {
  const upload = uploads.get(key);
  if (upload) upload.preview = preview;
}

export type ImageSpec = {
  id?: number | null;
  upload?: string | null;
  full?: boolean;
  // As XenForo writes it: `300px` (the editor's own) or `50%`.
  width?: string | null;
  alt?: string;
  // The tag as it was written, kept while nothing about the picture changes.
  raw?: string | null;
};

// Alt text as it can stand in an attribute: no quotation mark, bracket or line break (XenForo drops
// the quotation marks too), at most 200 characters.
const cleanAlt = (alt: string) =>
  alt
    .replace(/["[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

export function attachBb(
  id: number,
  full: boolean,
  width: string | null,
  alt: string,
) {
  if (!width && !alt)
    return full ? `[ATTACH=full]${id}[/ATTACH]` : `[ATTACH]${id}[/ATTACH]`;
  const type = full ? ' type="full"' : "";
  const size = width ? ` width="${width}"` : "";
  const text = alt ? ` alt="${alt}"` : "";
  return `[ATTACH${type}${size}${text}]${id}[/ATTACH]`;
}

// The picture a tag of the attachment list puts in (`attachTag`), or null for any other text.
export function attachOf(text: string): { id: number; full: boolean } | null {
  const match = /^\[ATTACH(=full)?\]([1-9]\d{0,11})\[\/ATTACH\]$/i.exec(text);
  return match ? { id: Number(match[2]), full: match[1] !== undefined } : null;
}

type SerializedImageNode = Spread<
  {
    id: number | null;
    upload: string | null;
    full: boolean;
    width: string | null;
    alt: string;
    raw: string | null;
  },
  SerializedLexicalNode
>;

export class ImageNode extends DecoratorNode<JSX.Element> {
  __id: number | null;
  __upload: string | null;
  __full: boolean;
  __width: string | null;
  __alt: string;
  __raw: string | null;

  static getType() {
    return "attach-image";
  }

  static clone(node: ImageNode) {
    return new ImageNode(
      {
        id: node.__id,
        upload: node.__upload,
        full: node.__full,
        width: node.__width,
        alt: node.__alt,
        raw: node.__raw,
      },
      node.__key,
    );
  }

  static importJSON(json: SerializedImageNode) {
    return $createImageNode(json);
  }

  constructor(spec: ImageSpec = {}, key?: NodeKey) {
    super(key);
    this.__id = spec.id ?? null;
    this.__upload = spec.upload ?? null;
    this.__full = spec.full ?? true;
    this.__width = spec.width ?? null;
    this.__alt = spec.alt ?? "";
    this.__raw = spec.raw ?? null;
  }

  exportJSON(): SerializedImageNode {
    return {
      ...super.exportJSON(),
      // A copy in another editor, or after a reload, has no upload to ask.
      id: this.storedId(),
      upload: this.__upload,
      full: this.__full,
      width: this.__width,
      alt: this.__alt,
      raw: this.__raw,
    };
  }

  createDOM() {
    const box = document.createElement("span");
    box.className = "relative inline-block max-w-full align-bottom";
    return box;
  }

  updateDOM() {
    return false;
  }

  isInline() {
    return true;
  }

  // Read without `getLatest`, so that `decorate` can call it too.
  private storedId(): number | null {
    return this.__id ?? uploadOf(this.__upload)?.id ?? null;
  }

  getId() {
    return this.getLatest().storedId();
  }

  uploadState(): "pending" | "done" | "failed" | null {
    const upload = uploadOf(this.getLatest().__upload);
    if (!upload) return null;
    return upload.id ? "done" : upload.failed ? "failed" : "pending";
  }

  isFull() {
    return this.getLatest().__full;
  }

  getWidth() {
    return this.getLatest().__width;
  }

  getAlt() {
    return this.getLatest().__alt;
  }

  // A picture given a size (a width, or none for its own) is drawn at that size: a thumbnail
  // becomes the picture itself.
  setWidth(width: string | null) {
    const self = this.getWritable();
    self.__width = width;
    self.__full = true;
    self.__raw = null;
  }

  setAlt(alt: string) {
    const self = this.getWritable();
    self.__alt = cleanAlt(alt);
    self.__raw = null;
  }

  // The BB code of the picture, which is what the editor writes for it; nothing while it uploads.
  getTextContent() {
    const self = this.getLatest();
    const id = self.storedId();
    if (id === null) return "";
    return self.__raw ?? attachBb(id, self.__full, self.__width, self.__alt);
  }

  decorate() {
    return (
      <ImageView
        nodeKey={this.__key}
        id={this.storedId()}
        upload={this.__upload}
        full={this.__full}
        width={this.__width}
        alt={this.__alt}
      />
    );
  }
}

export function $createImageNode(spec: ImageSpec) {
  return $applyNodeReplacement(new ImageNode(spec));
}

export function $isImageNode(
  node: LexicalNode | null | undefined,
): node is ImageNode {
  return node instanceof ImageNode;
}

// Every picture in the editor.
export function $allImages(): ImageNode[] {
  const found: ImageNode[] = [];
  const walk = (node: LexicalNode) => {
    if ($isImageNode(node)) found.push(node);
    else if ($isElementNode(node))
      for (const kid of node.getChildren()) walk(kid);
  };
  walk($getRoot());
  return found;
}

// Puts pictures in at the caret, over the selection if there is one; an editor that never had the
// focus has no selection yet, and they go at its end. Code shows a tag as text and is not a place
// for a picture: with the caret there, they go on a line of their own after the block.
export function $insertImage(...specs: ImageSpec[]) {
  let selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    $getRoot().selectEnd();
    selection = $getSelection();
  }
  if (!$isRangeSelection(selection)) return;
  const nodes = specs.map($createImageNode);
  const block = selection.anchor.getNode().getTopLevelElement();
  if ($isCodeNode(block)) {
    const after = $createParagraphNode().append(...nodes);
    block.insertAfter(after);
    after.selectEnd();
  } else selection.insertNodes(nodes);
}

// Draws every copy of the picture under `key` again, now that there is more to show (its preview,
// or how its upload ended), with its id once it has one. Not a step of its own for Undo.
function redraw(editor: LexicalEditor, key: string) {
  editor.update(() => {
    $addUpdateTag(HISTORY_MERGE_TAG);
    const id = uploads.get(key)?.id;
    for (const image of $allImages()) {
      if (image.__upload !== key) continue;
      const self = image.getWritable();
      if (id) self.__id = id;
    }
  });
}

// The pictures among files pasted or dropped into the editor (the files the attachment list was
// just given) go in at the caret at once, each under a key its file carries to the list; each
// shows the member's own copy as soon as it is read.
export function placeUploads(editor: LexicalEditor, files: File[]) {
  const keys = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => {
      const key = startUpload();
      const mine = started.get(editor) ?? new Set();
      started.set(editor, mine.add(key));
      placeFile(file, key);
      if (typeof FileReader !== "undefined") {
        const reader = new FileReader();
        reader.onload = () => {
          // Not when the upload ended first: its copy is no longer needed.
          const upload = uploads.get(key);
          if (typeof reader.result !== "string" || !upload) return;
          if (upload.id || upload.failed) return;
          showPreview(key, reader.result);
          redraw(editor, key);
        };
        reader.readAsDataURL(file);
      }
      return key;
    });
  if (keys.length)
    editor.update(() => $insertImage(...keys.map((upload) => ({ upload }))), {
      discrete: true,
    });
}

// The upload of the picture under `key` ended: stored under `id`, or refused.
export function finishUpload(editor: LexicalEditor, key: string, id?: number) {
  settleUpload(key, id);
  redraw(editor, key);
}
