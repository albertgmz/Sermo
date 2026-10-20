import {
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  type LexicalEditor,
  mergeRegister,
  PASTE_COMMAND,
  PASTE_TAG,
} from "lexical";
import { $insertBb } from "@/components/forum/bb-lexical";
import { htmlToBb } from "@/components/forum/html-to-bb";

// What a paste puts in: pasted rich text becomes BB code, so that bold, links, lists and the rest
// arrive as formatting and everything else as text, and plain text is taken as typed (its tags
// stay text). The editor's own copies keep Lexical's paste.
function pastedBb(data: DataTransfer): { bb: string; literal: boolean } {
  const html = data.getData("text/html");
  if (html) {
    const bb = htmlToBb(
      new DOMParser().parseFromString(html, "text/html").body,
    );
    if (bb) return { bb, literal: false };
  }
  return { bb: data.getData("text/plain"), literal: true };
}

// A paste is files when it holds files and no text: a screenshot, a copied file, a picture copied
// from a page. Anything with text to it (a cell copied from a spreadsheet comes with a picture of
// itself) is taken as text.
function pastedFiles(data: DataTransfer) {
  if (data.files.length === 0) return [];
  return data.getData("text/plain").trim() ? [] : Array.from(data.files);
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
};

const two = (value: number) => String(value).padStart(2, "0");

// Gives the pictures a paste brings a name that tells them apart. Browsers send a pasted picture
// as "image.png" or with no name at all; a file with a name of its own keeps it.
export function nameFiles(files: File[], prefix: string, now: Date): File[] {
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return files.map((file, index) => {
    if (file.name && !/^image\.[a-z0-9]+$/i.test(file.name)) return file;
    const extension =
      EXTENSIONS[file.type] ??
      (file.type.startsWith("image/")
        ? file.type.slice("image/".length)
        : file.name.split(".")[1]);
    const name = `${prefix}-${stamp}${files.length > 1 ? `-${index + 1}` : ""}${extension ? `.${extension}` : ""}`;
    return new File([file], name, {
      type: file.type,
      lastModified: file.lastModified,
    });
  });
}

// The commands that bring things into the editor from outside, at the priority that keeps
// Lexical's own from putting anything in on its own: pasted text becomes BB code, the editor's own
// copies keep Lexical's paste, and files (pasted or dropped) go to `onFiles`, which uploads them.
// The editor takes no file itself.
export function registerPaste(
  editor: LexicalEditor,
  onFiles: (files: File[]) => void,
) {
  return mergeRegister(
    editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        // Never allow native insertion, even without a Lexical selection.
        event.preventDefault();
        // A keyboard's paste may arrive as an input event, which carries its data as `dataTransfer`.
        const data =
          "clipboardData" in event
            ? event.clipboardData
            : "dataTransfer" in event
              ? event.dataTransfer
              : null;
        if (!data) return true;
        const files = pastedFiles(data);
        if (files.length > 0) {
          onFiles(files);
          return true;
        }
        if (data.types.includes("application/x-lexical-editor")) {
          return false;
        }
        const { bb, literal } = pastedBb(data);
        if (bb) {
          const plain = data.getData("text/plain") || bb;
          editor.update(() => $insertBb(bb, literal, plain), {
            tag: PASTE_TAG,
          });
        }
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DROP_COMMAND,
      (event) => {
        // External drops otherwise fall through to native DOM insertion.
        event.preventDefault();
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length > 0) onFiles(files);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
