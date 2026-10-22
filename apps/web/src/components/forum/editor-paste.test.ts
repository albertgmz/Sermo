import { afterAll, beforeAll, expect, test } from "bun:test";
import { registerRichText } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  createEditor,
  DROP_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { $exportBb, BB_NODES } from "./bb-lexical";
import { offerFiles, onFilesOffered } from "./composer-insert";
import { prepareFiles, registerPaste } from "./editor-paste";
import { pastedFiles } from "./pasted-files";

function setup() {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerRichText(editor);
  const taken: File[][] = [];
  const told: boolean[] = [];
  registerPaste(editor, (files, pasted) => {
    taken.push(files);
    told.push(pasted);
  });
  editor.update(
    () => {
      const node = $createTextNode("");
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select();
    },
    { discrete: true },
  );
  const bb = () => {
    let out = "";
    editor.read(() => {
      out = $exportBb();
    });
    return out;
  };
  return { editor, taken, told, bb };
}

const picture = (name = "image.png", type = "image/png") =>
  new File(["x"], name, { type });

function transfer(parts: { files?: File[]; data?: Record<string, string> }) {
  const data = parts.data ?? {};
  const files = parts.files ?? [];
  return {
    files,
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    getData: (type: string) => data[type] ?? "",
  };
}

function paste(
  editor: ReturnType<typeof setup>["editor"],
  clipboard: ReturnType<typeof transfer>,
  as: "clipboardData" | "dataTransfer" = "clipboardData",
) {
  let prevented = false;
  const handled = editor.dispatchCommand(PASTE_COMMAND, {
    [as]: clipboard,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as ClipboardEvent);
  return { handled, prevented };
}

test("a pasted picture goes to the file handler and puts nothing in the text", () => {
  const { editor, taken, bb } = setup();
  const file = picture();
  const result = paste(editor, transfer({ files: [file] }));
  expect(result).toEqual({ handled: true, prevented: true });
  expect(taken).toEqual([[file]]);
  expect(bb()).toBe("");
});

test("several pasted files go together, whatever their type", () => {
  const { editor, taken } = setup();
  const files = [
    picture(),
    picture("a.pdf", "application/pdf"),
    picture("b", ""),
  ];
  paste(editor, transfer({ files }));
  expect(taken).toEqual([files]);
});

test("a paste that arrives as an input event carries its files in dataTransfer", () => {
  const { editor, taken } = setup();
  const file = picture();
  paste(editor, transfer({ files: [file] }), "dataTransfer");
  expect(taken).toEqual([[file]]);
});

test("files that come with text are pasted as text", () => {
  const { editor, taken, bb } = setup();
  paste(
    editor,
    transfer({ files: [picture()], data: { "text/plain": "A1\tB1" } }),
  );
  expect(taken).toEqual([]);
  expect(bb()).toBe("A1\tB1");
});

test("a picture copied from a page comes as html with a file and is taken as the file", () => {
  const { editor, taken, bb } = setup();
  const file = picture();
  paste(
    editor,
    transfer({
      files: [file],
      data: { "text/html": '<meta><img src="https://example.test/a.png">' },
    }),
  );
  expect(taken).toEqual([[file]]);
  expect(bb()).toBe("");
});

test("plain text is pasted as typed, and no file is offered", () => {
  const { editor, taken, bb } = setup();
  paste(editor, transfer({ data: { "text/plain": "[B]kept[/B] as text" } }));
  expect(taken).toEqual([]);
  expect(bb()).toContain("kept");
});

test("the editor's own copies are left to Lexical's paste", () => {
  const { editor, taken } = setup();
  let reached = false;
  editor.registerCommand(
    PASTE_COMMAND,
    () => {
      reached = true;
      return true;
    },
    COMMAND_PRIORITY_NORMAL,
  );
  const result = paste(
    editor,
    transfer({ data: { "application/x-lexical-editor": "{}" } }),
  );
  expect(reached).toBe(true);
  expect(taken).toEqual([]);
  expect(result.prevented).toBe(true);
});

test("a paste with no data inserts nothing", () => {
  const { editor, taken, bb } = setup();
  let prevented = false;
  editor.dispatchCommand(PASTE_COMMAND, {
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as ClipboardEvent);
  expect(prevented).toBe(true);
  expect(taken).toEqual([]);
  expect(bb()).toBe("");
});

// Lexical tells a drag from a clipboard event by the event's class name, which a test without a
// browser has to give it.
class DragEvent {
  clientX = 0;
  clientY = 0;
  prevented = false;
  constructor(readonly dataTransfer: unknown) {}
  preventDefault() {
    this.prevented = true;
  }
}
Object.assign(globalThis, { DragEvent });

// Where Lexical looks for the caret under the pointer: a page with nothing at that point.
const nowhere = { caretRangeFromPoint: () => null };
let hadDocument: PropertyDescriptor | undefined;
beforeAll(() => {
  hadDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.assign(globalThis, { document: nowhere });
});
afterAll(() => {
  if (hadDocument) Object.defineProperty(globalThis, "document", hadDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

function drop(
  editor: ReturnType<typeof setup>["editor"],
  dataTransfer: unknown,
) {
  const event = new DragEvent(dataTransfer);
  const handled = editor.dispatchCommand(
    DROP_COMMAND,
    event as unknown as globalThis.DragEvent,
  );
  return { handled, prevented: event.prevented };
}

// Counts the drops that get past the handler of this file, and stops them there.
function watchDrops(editor: ReturnType<typeof setup>["editor"]) {
  const seen = { count: 0 };
  editor.registerCommand(
    DROP_COMMAND,
    () => {
      seen.count += 1;
      return true;
    },
    COMMAND_PRIORITY_LOW,
  );
  return seen;
}

test("dropped files are left to Lexical's own drop handling, which puts the caret where they were released and offers them", () => {
  const { editor, taken } = setup();
  const seen = watchDrops(editor);
  const files = [picture("a.png"), picture("b.jpg", "image/jpeg")];
  drop(editor, transfer({ files }));
  expect(seen.count).toBe(1);
  expect(taken).toEqual([]);
  // Without the watcher Lexical offers them, once, as a drop.
  const other = setup();
  expect(drop(other.editor, transfer({ files }))).toEqual({
    handled: true,
    prevented: true,
  });
  expect(other.taken).toEqual([files]);
  expect(other.told).toEqual([false]);
});

test("text dragged inside the editor is left to Lexical, any other external drop is refused and offers nothing", () => {
  const { editor, taken, bb } = setup();
  const seen = watchDrops(editor);
  expect(drop(editor, transfer({ data: { "text/plain": "text" } }))).toEqual({
    handled: true,
    prevented: true,
  });
  expect(drop(editor, null).handled).toBe(true);
  expect(seen.count).toBe(0);
  expect(
    drop(editor, transfer({ data: { "application/x-lexical-drag": "{}" } }))
      .prevented,
  ).toBe(false);
  expect(seen.count).toBe(1);
  expect(taken).toEqual([]);
  expect(bb()).toBe("");
});

const NOW = new Date(2026, 9, 19, 14, 5, 9);
const prepare = (files: File[], pasted = true, prefix = "pasted") =>
  prepareFiles(files, { prefix, now: NOW, pasted });

test('a pasted picture with no name, or the browser\'s "image.png", is named after when it was pasted', async () => {
  const [one] = await prepare([picture("image.png")]);
  expect(one.name).toBe("pasted-2026-10-19-140509.png");
  expect(one.type).toBe("image/png");
  const [jpeg] = await prepare([picture("", "image/jpeg")], true, "pegado");
  expect(jpeg.name).toBe("pegado-2026-10-19-140509.jpg");
  const [unknown] = await prepare([picture("", "")]);
  expect(unknown.name).toBe("pasted-2026-10-19-140509");
});

test("pictures pasted in the same second are named apart, in the order they came", async () => {
  const used = new Set<string>();
  const name = async (files: File[]) =>
    (
      await prepareFiles(files, {
        prefix: "pasted",
        now: NOW,
        pasted: true,
        used,
      })
    ).map((file) => file.name);
  expect(await name([picture("image.png")])).toEqual([
    "pasted-2026-10-19-140509.png",
  ]);
  expect(await name([picture("image.png")])).toEqual([
    "pasted-2026-10-19-140509-2.png",
  ]);
  expect(await name([picture("image.png")])).toEqual([
    "pasted-2026-10-19-140509-3.png",
  ]);
  expect(await name([picture("image.png"), picture("image.png")])).toEqual([
    "pasted-2026-10-19-140509-1.png",
    "pasted-2026-10-19-140509-2-2.png",
  ]);
});

test("a dropped file keeps its name even when it is image.png", async () => {
  const dropped = picture("image.png");
  expect(await prepare([dropped], false)).toEqual([dropped]);
  const [nameless] = await prepare([picture("")], false);
  expect(nameless.name).toBe("pasted-2026-10-19-140509.png");
});

test("several nameless pictures get numbers, and a file with a name keeps it", async () => {
  const named = picture("plan.png");
  const out = await prepare([
    picture("image.png"),
    named,
    picture("image.png"),
  ]);
  expect(out.map((file) => file.name)).toEqual([
    "pasted-2026-10-19-140509-1.png",
    "plan.png",
    "pasted-2026-10-19-140509-3.png",
  ]);
  expect(out[1]).toBe(named);
});

const bytes = (...values: number[]): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(values);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

test("a file sent with no type gets the one its bytes show, then the one its name says", async () => {
  const cases: [Uint8Array<ArrayBuffer>, string, string, string][] = [
    [PNG, "", "", "image/png"],
    [PNG, "", "application/octet-stream", "image/png"],
    [bytes(0xff, 0xd8, 0xff, 0xe0), "", "", "image/jpeg"],
    [bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61), "", "", "image/gif"],
    [
      bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50),
      "",
      "",
      "image/webp",
    ],
    [bytes(1, 2, 3, 4), "shot.PNG", "", "image/png"],
    [bytes(1, 2, 3, 4), "notes.txt", "", ""],
    [bytes(1, 2, 3, 4), "", "", ""],
  ];
  for (const [content, name, type, expected] of cases) {
    const [sent] = await prepare([new File([content], name, { type })], false);
    expect(sent.type).toBe(expected);
  }
});

test("a file that has its type is not touched", async () => {
  const typed = picture("a.png", "image/png");
  expect((await prepare([typed]))[0]).toBe(typed);
});

// What browsers put next to a copied picture or file, and when it is still the files.
const IMG_ONLY = '<meta charset="utf-8"><img src="https://example.test/a.png">';
const clipboards: [string, ReturnType<typeof transfer>, boolean][] = [
  ["no text at all", transfer({ files: [picture()] }), true],
  [
    "only white space",
    transfer({ files: [picture()], data: { "text/plain": " \r\n " } }),
    true,
  ],
  [
    "the name of the file (a file manager's copy)",
    transfer({
      files: [picture("holiday photo.png")],
      data: { "text/plain": "holiday photo.png" },
    }),
    true,
  ],
  [
    "the address of the picture and HTML that is only the picture (Firefox, Safari)",
    transfer({
      files: [picture()],
      data: {
        "text/plain": "https://example.test/a.png",
        "text/html": IMG_ONLY,
      },
    }),
    true,
  ],
  [
    "the address of the picture and no HTML",
    transfer({
      files: [picture()],
      data: { "text/plain": "https://example.test/a.png" },
    }),
    true,
  ],
  [
    "the path of the file",
    transfer({
      files: [picture()],
      data: { "text/plain": "C:\\Users\\ana\\Pictures\\a.png" },
    }),
    true,
  ],
  [
    "a path that starts at the root",
    transfer({
      files: [picture()],
      data: { "text/plain": "/home/ana/Pictures/a b.png" },
    }),
    true,
  ],
  [
    "an address and HTML that has words of its own",
    transfer({
      files: [picture()],
      data: {
        "text/plain": "https://example.test/a.png",
        "text/html": '<p>See <a href="https://example.test/a.png">this</a></p>',
      },
    }),
    false,
  ],
  [
    "a spreadsheet cell and the picture of it",
    transfer({
      files: [picture()],
      data: {
        "text/plain": "Total\t42",
        "text/html": "<table><tr><td>Total</td><td>42</td></tr></table>",
      },
    }),
    false,
  ],
  [
    "several lines of text",
    transfer({
      files: [picture()],
      data: {
        "text/plain": "https://example.test/a.png\nhttps://example.test/b.png",
      },
    }),
    false,
  ],
  [
    "words",
    transfer({ files: [picture()], data: { "text/plain": "look at this" } }),
    false,
  ],
  [
    "no files",
    transfer({ data: { "text/plain": "https://example.test" } }),
    false,
  ],
];

for (const [name, clipboard, asFiles] of clipboards) {
  test(`a paste of files with ${name} is ${asFiles ? "the files" : "text"}`, () => {
    expect(pastedFiles(clipboard).length > 0).toBe(asFiles);
    // The paste of text with HTML needs a DOM parser, which these tests do not have.
    if (!asFiles && clipboard.getData("text/html")) return;
    const { editor, taken } = setup();
    paste(editor, clipboard);
    expect(taken.length).toBe(asFiles ? 1 : 0);
  });
}

test("what is told with the files: pasted or dropped", () => {
  const { editor, told } = setup();
  paste(editor, transfer({ files: [picture()] }));
  drop(editor, transfer({ files: [picture()] }));
  expect(told).toEqual([true, false]);
});

test("files offered to a composer go to the first list that takes them", () => {
  const form = new EventTarget() as unknown as HTMLFormElement;
  const files = [picture()];
  expect(offerFiles(form, files)).toBe(false);
  const first: File[][] = [];
  const second: File[][] = [];
  const stopFirst = onFilesOffered(form, (offered) => first.push(offered));
  onFilesOffered(form, (offered) => second.push(offered));
  expect(offerFiles(form, files)).toBe(true);
  expect(first).toEqual([files]);
  expect(second).toEqual([]);
  stopFirst();
  expect(offerFiles(form, files)).toBe(true);
  expect(second).toEqual([files]);
});

test("a composer with no form, or whose list is not listening, takes nothing", () => {
  expect(offerFiles(null, [picture()])).toBe(false);
  expect(offerFiles(undefined, [picture()])).toBe(false);
  expect(onFilesOffered(null, () => {})).toBeInstanceOf(Function);
});

test("a supported address pasted in an empty line becomes its media tag", () => {
  const { editor, bb } = setup();
  paste(
    editor,
    transfer({ data: { "text/plain": "https://youtu.be/dQw4w9WgXcQ?t=5\n" } }),
  );
  expect(bb()).toBe("[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]");
});

test("a supported address pasted among words stays the address", () => {
  const { editor, bb } = setup();
  editor.update(
    () => {
      const node = $createTextNode("watch ");
      $getRoot().clear().append($createParagraphNode().append(node));
      node.selectEnd();
    },
    { discrete: true },
  );
  paste(
    editor,
    transfer({ data: { "text/plain": "https://youtu.be/dQw4w9WgXcQ" } }),
  );
  expect(bb()).toBe("watch https://youtu.be/dQw4w9WgXcQ");
});

test("an address of a site that is not embedded is pasted as it is", () => {
  const { editor, bb } = setup();
  paste(editor, transfer({ data: { "text/plain": "https://example.com/a" } }));
  expect(bb()).toBe("https://example.com/a");
});
