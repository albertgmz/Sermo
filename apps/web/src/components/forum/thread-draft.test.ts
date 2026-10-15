import { expect, test } from "bun:test";
import {
  clearThreadDraft,
  readThreadDraft,
  THREAD_DRAFT_KEY,
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
  writeThreadDraft(DRAFT, store);
  expect(readThreadDraft(store)).toEqual(DRAFT);
});

test("a draft with nothing in it is not kept, and one that empties is forgotten", () => {
  const store = memory();
  writeThreadDraft({ title: "  ", body: "\n", prefixId: "" }, store);
  expect(store.items.size).toBe(0);
  writeThreadDraft(DRAFT, store);
  writeThreadDraft({ title: "", body: "", prefixId: "" }, store);
  expect(store.items.size).toBe(0);
});

test("a thread that is sent leaves no draft behind", () => {
  const store = memory();
  writeThreadDraft(DRAFT, store);
  clearThreadDraft(store);
  expect(readThreadDraft(store)).toBeNull();
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
    store.items.set(THREAD_DRAFT_KEY, raw);
    expect(readThreadDraft(store)).toBeNull();
  }
});

test("storage that is missing or throws never breaks the composer", () => {
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
  expect(readThreadDraft(broken)).toBeNull();
  expect(() => writeThreadDraft(DRAFT, broken)).not.toThrow();
  expect(() => clearThreadDraft(broken)).not.toThrow();
  expect(readThreadDraft(null)).toBeNull();
  expect(() => writeThreadDraft(DRAFT, null)).not.toThrow();
  expect(() => clearThreadDraft(null)).not.toThrow();
});
