import { afterEach, beforeEach, expect, test } from "bun:test";
import { keepEditDraft, takeEditDraft } from "./edit-draft";

// "More options" carries what the post's editor in the thread had to the edit page: the text and
// the files as the editor listed them, so a file uploaded and placed in the text stays the post's
// and one removed stays removed.

const stored = new Map<string, string>();
const realStorage = (globalThis as { sessionStorage?: unknown }).sessionStorage;
beforeEach(() => {
  stored.clear();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
});
afterEach(() => {
  (globalThis as { sessionStorage?: unknown }).sessionStorage = realStorage;
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

test("the files the editor listed travel with the text, once", () => {
  const listed = [
    // Kept from the saved post; a second one was removed in the editor.
    { id: 4, name: "kept.png", size: 120, type: "image/png" },
    // Uploaded in the editor and placed in the text.
    { id: 9, name: "new.jpg", size: 300, type: "image/jpeg" },
  ];
  keepEditDraft(31, form({ body: "Text [ATTACH=full]9[/ATTACH]" }), listed);
  expect(takeEditDraft(31)).toEqual({
    body: "Text [ATTACH=full]9[/ATTACH]",
    title: undefined,
    prefixId: undefined,
    attached: listed,
  });
  // Read once: coming back to the page later opens the saved post.
  expect(takeEditDraft(31)).toBeNull();
});

test("an editor with no file list carries none, and the page keeps the saved files", () => {
  keepEditDraft(31, form({ body: "b", title: "T", prefixId: "4" }), null);
  expect(takeEditDraft(31)).toEqual({
    body: "b",
    title: "T",
    prefixId: "4",
    attached: undefined,
  });
});

test("a kept list that is not a list of files is dropped, the text kept", () => {
  stored.set(
    "sermo-edit-draft:31",
    JSON.stringify({ body: "b", attached: [{ id: "x" }] }),
  );
  expect(takeEditDraft(31)).toEqual({ body: "b", attached: undefined });
});
