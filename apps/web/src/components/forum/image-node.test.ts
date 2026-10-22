import { expect, test } from "bun:test";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";
import { placedKey } from "./composer-insert";
import { $removeAttachTags } from "./editor-commands";
import {
  $createImageNode,
  $findUpload,
  $insertImage,
  $isImageNode,
  attachOf,
  finishUpload,
  type ImageNode,
  placeUploads,
  settleUpload,
  startUpload,
} from "./image-node";

function editorOf(source: string) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $replaceWithBb(source), { discrete: true });
  return editor;
}

const run = (editor: LexicalEditor, change: () => void) =>
  editor.update(change, { discrete: true });

function bbOf(editor: LexicalEditor) {
  return editor.read(() => $exportBb());
}

function $images(): ImageNode[] {
  const found: ImageNode[] = [];
  const walk = (node: LexicalNode) => {
    if ($isImageNode(node)) found.push(node);
    const kids = "getChildren" in node ? (node.getChildren as () => [])() : [];
    for (const kid of kids) walk(kid);
  };
  walk($getRoot());
  return found;
}

const shown = (editor: LexicalEditor) =>
  editor.read(() =>
    $images().map((image) => ({
      id: image.getId(),
      full: image.isFull(),
      width: image.getWidth(),
      alt: image.getAlt(),
    })),
  );

test("an attachment tag opens as the picture and is written back as it was", () => {
  const editor = editorOf(
    'a [ATTACH]12[/ATTACH] b [attach=FULL] 13 [/attach]\n\n[ATTACH type="full" width="300px" alt="Mapa de Cuba"]5[/ATTACH]',
  );
  expect(shown(editor)).toEqual([
    { id: 12, full: false, width: null, alt: "" },
    { id: 13, full: true, width: null, alt: "" },
    { id: 5, full: true, width: "300px", alt: "Mapa de Cuba" },
  ]);
  expect(bbOf(editor)).toBe(
    'a [ATTACH]12[/ATTACH] b [attach=FULL] 13 [/attach]\n\n[ATTACH type="full" width="300px" alt="Mapa de Cuba"]5[/ATTACH]',
  );
});

test("an attachment tag inside a format, a link or code, or one the renderer does not read, stays text", () => {
  for (const source of [
    "[B][ATTACH]1[/ATTACH] bold[/B]",
    "[URL=https://a.test/x][ATTACH]1[/ATTACH][/URL]",
    "[ICODE][ATTACH]1[/ATTACH][/ICODE] in a line",
    "[CODE]\n[ATTACH]1[/ATTACH]\n[/CODE]",
    "[ATTACH]x[/ATTACH] [ATTACH=huge]1[/ATTACH] [ATTACH type=full]1[/ATTACH]",
  ]) {
    const editor = editorOf(source);
    expect(shown(editor), source).toEqual([]);
    expect(bbOf(editor)).toBe(source);
  }
});

test("a size or alt text given in the editor is written as XenForo writes it", () => {
  const editor = editorOf("[ATTACH=full]5[/ATTACH] and [ATTACH]6[/ATTACH]");
  run(editor, () => {
    const [full, thumb] = $images();
    full.setWidth("320px");
    // A sized picture is drawn at that size: a thumbnail becomes the picture.
    thumb.setWidth("200px");
  });
  expect(bbOf(editor)).toBe(
    '[ATTACH type="full" width="320px"]5[/ATTACH] and [ATTACH type="full" width="200px"]6[/ATTACH]',
  );
  run(editor, () => $images()[0].setAlt(' Mapa "de" [Cuba]\n '));
  expect(bbOf(editor)).toBe(
    '[ATTACH type="full" width="320px" alt="Mapa de Cuba"]5[/ATTACH] and [ATTACH type="full" width="200px"]6[/ATTACH]',
  );
  run(editor, () => {
    $images()[0].setWidth(null);
    $images()[0].setAlt("");
  });
  expect(bbOf(editor)).toStartWith("[ATTACH=full]5[/ATTACH] and");
});

test("a picture being uploaded writes nothing until its upload ends, then its tag", () => {
  const editor = editorOf("");
  const done = startUpload();
  const refused = startUpload();
  run(editor, () => {
    $getRoot()
      .clear()
      .append(
        $createParagraphNode().append(
          $createTextNode("a "),
          $createImageNode({ upload: done }),
          $createTextNode(" b "),
          $createImageNode({ upload: refused }),
        ),
      );
  });
  expect(bbOf(editor)).toBe("a  b");
  settleUpload(done, 9);
  settleUpload(refused);
  run(editor, () => {
    $findUpload(done)?.getWritable();
    $findUpload(refused)?.getWritable();
  });
  expect(bbOf(editor)).toBe("a [ATTACH=full]9[/ATTACH] b");
  expect(
    editor.read(() => $images().map((image) => image.uploadState())),
  ).toEqual(["done", "failed"]);
});

test("removing an attachment takes its pictures out too", () => {
  const editor = editorOf(
    'a [ATTACH]4[/ATTACH] b [ATTACH type="full" width="300px"]4[/ATTACH] c [ATTACH]5[/ATTACH]',
  );
  run(editor, () => $removeAttachTags(4));
  expect(bbOf(editor)).toBe("a  b  c [ATTACH]5[/ATTACH]");
});

test("a tag the attachment list asks for goes in as the picture, at the caret", () => {
  expect(attachOf("[ATTACH=full]12[/ATTACH]")).toEqual({ id: 12, full: true });
  expect(attachOf("[ATTACH]3[/ATTACH]")).toEqual({ id: 3, full: false });
  expect(attachOf("text [ATTACH]3[/ATTACH]")).toBeNull();
  expect(attachOf("[QUOTE]x[/QUOTE]")).toBeNull();
  const editor = editorOf("before after");
  run(editor, () => {
    const text = $getRoot().getAllTextNodes()[0];
    text.select(7, 7);
    $insertImage({ id: 12, full: true });
  });
  expect(bbOf(editor)).toBe("before [ATTACH=full]12[/ATTACH]after");
});

test("pictures pasted or dropped go in at the caret at once, each under a key its file carries", () => {
  const editor = editorOf("before after");
  run(editor, () => $getRoot().getAllTextNodes()[0].select(7, 7));
  const shot = new File(["x"], "shot.png", { type: "image/png" });
  const plan = new File(["x"], "plan.pdf", { type: "application/pdf" });
  placeUploads(editor, [shot, plan]);
  const key = placedKey(shot) as string;
  expect(key).toBeString();
  expect(placedKey(plan)).toBeUndefined();
  expect(
    editor.read(() => $images().map((image) => image.uploadState())),
  ).toEqual(["pending"]);
  expect(bbOf(editor)).toBe("before after");
  finishUpload(editor, key, 4);
  expect(bbOf(editor)).toBe("before [ATTACH=full]4[/ATTACH]after");
});
