import { expect, test } from "bun:test";
import { registerRichText } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  COMMAND_PRIORITY_NORMAL,
  createEditor,
  DROP_COMMAND,
  PASTE_COMMAND,
} from "lexical";
import { $exportBb, BB_NODES } from "./bb-lexical";
import { offerFiles, onFilesOffered } from "./composer-insert";
import { nameFiles, registerPaste } from "./editor-paste";

function setup() {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerRichText(editor);
  const taken: File[][] = [];
  registerPaste(editor, (files) => taken.push(files));
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
  return { editor, taken, bb };
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

function drop(
  editor: ReturnType<typeof setup>["editor"],
  dataTransfer: ReturnType<typeof transfer> | null,
) {
  let prevented = false;
  const handled = editor.dispatchCommand(DROP_COMMAND, {
    dataTransfer,
    preventDefault: () => {
      prevented = true;
    },
  } as unknown as DragEvent);
  return { handled, prevented };
}

test("dropped files go to the file handler", () => {
  const { editor, taken } = setup();
  const files = [picture("a.png"), picture("b.jpg", "image/jpeg")];
  expect(drop(editor, transfer({ files }))).toEqual({
    handled: true,
    prevented: true,
  });
  expect(taken).toEqual([files]);
});

test("a drop with no files is refused as before and offers nothing", () => {
  const { editor, taken, bb } = setup();
  expect(drop(editor, transfer({ data: { "text/plain": "text" } }))).toEqual({
    handled: true,
    prevented: true,
  });
  expect(drop(editor, null).handled).toBe(true);
  expect(taken).toEqual([]);
  expect(bb()).toBe("");
});

test('a picture with no name, or the browser\'s "image.png", is named after when it was pasted', () => {
  const now = new Date(2026, 9, 19, 14, 5, 9);
  const [one] = nameFiles([picture("image.png")], "pasted", now);
  expect(one.name).toBe("pasted-2026-10-19-140509.png");
  expect(one.type).toBe("image/png");
  const [jpeg] = nameFiles([picture("", "image/jpeg")], "pegado", now);
  expect(jpeg.name).toBe("pegado-2026-10-19-140509.jpg");
  const [typeless] = nameFiles([picture("", "")], "pegado", now);
  expect(typeless.name).toBe("pegado-2026-10-19-140509");
});

test("several nameless pictures get numbers, and a file with a name keeps it", () => {
  const now = new Date(2026, 0, 2, 3, 4, 5);
  const named = picture("plan.png");
  const out = nameFiles(
    [picture("image.png"), named, picture("image.png")],
    "pasted",
    now,
  );
  expect(out.map((file) => file.name)).toEqual([
    "pasted-2026-01-02-030405-1.png",
    "plan.png",
    "pasted-2026-01-02-030405-3.png",
  ]);
  expect(out[1]).toBe(named);
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
