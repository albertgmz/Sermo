import { expect, test } from "bun:test";
import {
  clearThreadDraft,
  readThreadDraft,
  threadDraftKey,
  writeThreadDraft,
} from "./thread-draft";

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const DRAFT = {
  title: "Where do I start?",
  body: "Some **text**",
  prefixId: "7",
};

test("a closed composer's draft comes back as it was written", () => {
  const store = memory();
  writeThreadDraft(1, DRAFT, store);
  expect(readThreadDraft(1, store)).toEqual(DRAFT);
});

test("a draft with nothing in it is not kept, and one that empties is forgotten", () => {
  const store = memory();
  writeThreadDraft(1, { title: "  ", body: "\n", prefixId: "" }, store);
  expect(store.items.size).toBe(0);
  writeThreadDraft(1, DRAFT, store);
  writeThreadDraft(1, { title: "", body: "", prefixId: "" }, store);
  expect(store.items.size).toBe(0);
});

test("a thread that is sent leaves no draft behind", () => {
  const store = memory();
  writeThreadDraft(1, DRAFT, store);
  clearThreadDraft(1, store);
  expect(readThreadDraft(1, store)).toBeNull();
});

test("a draft belongs to the member who wrote it", () => {
  const store = memory();
  writeThreadDraft(1, DRAFT, store);
  expect(readThreadDraft(2, store)).toBeNull();
  clearThreadDraft(2, store);
  expect(readThreadDraft(1, store)).toEqual(DRAFT);
});

test("the files are not kept, so the tags that placed them are dropped on the way back", () => {
  const store = memory();
  writeThreadDraft(
    1,
    {
      title: "T",
      body: 'Look [ATTACH]12[/ATTACH] and [ATTACH=full]13[/ATTACH] and [attach="thumb"] 14 [/attach] there',
      prefixId: "",
    },
    store,
  );
  expect(readThreadDraft(1, store)?.body).toBe("Look  and  and  there");
  // A draft that was only a tag is no draft.
  writeThreadDraft(
    1,
    { title: "", body: "[ATTACH]12[/ATTACH]", prefixId: "" },
    store,
  );
  expect(readThreadDraft(1, store)).toBeNull();
});

test("what storage holds that is not a draft is ignored", () => {
  const store = memory();
  for (const raw of [
    "{",
    "null",
    "[]",
    '{"title":1}',
    '{"title":"a","body":"b"}',
  ]) {
    store.items.set(threadDraftKey(1), raw);
    expect(readThreadDraft(1, store)).toBeNull();
  }
});

test("storage that is missing or throws, and a visitor with no id, never break the composer", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readThreadDraft(1, broken)).toBeNull();
  expect(() => writeThreadDraft(1, DRAFT, broken)).not.toThrow();
  expect(() => clearThreadDraft(1, broken)).not.toThrow();
  const store = memory();
  writeThreadDraft(null, DRAFT, store);
  expect(store.items.size).toBe(0);
  expect(readThreadDraft(null, store)).toBeNull();
  expect(() => clearThreadDraft(null, store)).not.toThrow();
});
