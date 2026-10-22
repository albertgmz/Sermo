import { DRAG_DROP_PASTE } from "@lexical/rich-text";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  type LexicalEditor,
  mergeRegister,
  PASTE_COMMAND,
  PASTE_TAG,
} from "lexical";
import { $insertBb } from "@/components/forum/bb-lexical";
import { htmlToBb } from "@/components/forum/html-to-bb";
import { mediaTagOf } from "@/components/forum/media-url";
import { pastedFiles } from "@/components/forum/pasted-files";

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

// Whether the caret stands in an empty line: a link pasted there is the whole line, which is what
// makes it a player (as XenForo embeds a pasted link).
function $inEmptyLine() {
  const selection = $getSelection();
  return (
    $isRangeSelection(selection) &&
    selection.isCollapsed() &&
    selection.anchor.getNode().getTopLevelElement()?.getTextContent().trim() ===
      ""
  );
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/heic": "heic",
};

// The type of a file the browser sent with none (some file managers and screenshot tools do),
// from its first bytes and then its name. The backend takes the type a file is sent with and does
// not look for one, so a file with none would be refused. Anything not recognised is sent as it is.
const SIGNATURES: [type: string, at: number, bytes: number[]][] = [
  ["image/png", 0, [0x89, 0x50, 0x4e, 0x47]],
  ["image/jpeg", 0, [0xff, 0xd8, 0xff]],
  ["image/gif", 0, [0x47, 0x49, 0x46, 0x38]],
  ["image/webp", 8, [0x57, 0x45, 0x42, 0x50]],
  ["image/avif", 4, [0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]],
  ["image/bmp", 0, [0x42, 0x4d]],
];
const BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
};

async function typeOf(file: File) {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  for (const [type, at, bytes] of SIGNATURES) {
    if (bytes.every((byte, index) => head[at + index] === byte)) return type;
  }
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return BY_EXTENSION[extension] ?? file.type;
}

const two = (value: number) => String(value).padStart(2, "0");

// What the pasted or dropped files are sent as: a file with no type gets the one it turns out to
// be, and a picture that came off the clipboard with no name, or the "image.png" browsers give
// every pasted picture, is named after the moment (a dropped file keeps its own name, whatever it
// is). Files with a name and a type are not touched. `used` holds the names given so far, so that
// two pictures pasted in the same second do not get the same one.
export async function prepareFiles(
  files: File[],
  {
    prefix,
    now,
    pasted,
    used,
  }: { prefix: string; now: Date; pasted: boolean; used?: Set<string> },
): Promise<File[]> {
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return Promise.all(
    files.map(async (file, index) => {
      const type = await typeOf(file);
      const nameless =
        file.name === "" || (pasted && /^image.[a-z0-9]+$/i.test(file.name));
      if (!nameless && type === file.type) return file;
      const extension =
        EXTENSIONS[type] ?? (file.name.split(".")[1] || undefined);
      let name = file.name;
      if (nameless) {
        const stem = `${prefix}-${stamp}${files.length > 1 ? `-${index + 1}` : ""}`;
        const ending = extension ? `.${extension}` : "";
        name = `${stem}${ending}`;
        for (let again = 2; used?.has(name); again += 1)
          name = `${stem}-${again}${ending}`;
        used?.add(name);
      }
      return new File([file], name, { type, lastModified: file.lastModified });
    }),
  );
}

// The type Lexical gives a drag that starts in an editor.
const DRAG_SOURCE = "application/x-lexical-drag";

// The commands that bring things into the editor from outside, at the priority that keeps
// Lexical's own from putting anything in on its own: pasted text becomes BB code, the editor's own
// copies keep Lexical's paste, and files (pasted or dropped) go to `onFiles`, which uploads them.
// The editor takes no file itself. A drop of files is left to Lexical's own handling, which puts the
// caret where the files were released and then offers them as DRAG_DROP_PASTE; text dragged inside
// the editor is left to it too.
export function registerPaste(
  editor: LexicalEditor,
  onFiles: (files: File[], pasted: boolean) => void,
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
          onFiles(files, true);
          return true;
        }
        if (data.types.includes("application/x-lexical-editor")) {
          return false;
        }
        const { bb, literal } = pastedBb(data);
        const media = mediaTagOf(data.getData("text/plain").trim());
        if (media) {
          editor.update(
            () => {
              if ($inEmptyLine()) $insertBb(media, true, media);
              else $insertBb(bb, literal, data.getData("text/plain") || bb);
            },
            { tag: PASTE_TAG },
          );
          return true;
        }
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
        const data = event.dataTransfer;
        if (data && Array.from(data.files).length > 0) return false;
        if (data?.types.includes(DRAG_SOURCE)) return false;
        // Other external drops otherwise fall through to native DOM insertion.
        event.preventDefault();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
    editor.registerCommand(
      DRAG_DROP_PASTE,
      (files) => {
        onFiles(files, false);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );
}
