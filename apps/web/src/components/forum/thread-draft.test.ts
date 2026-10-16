import { expect, test } from "bun:test";
import {
  clearThreadDraft,
  draftMovedOn,
  readThreadDraft,
  sameDraft,
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

test("a composer left hidden can tell that the draft kept in the tab has moved on, or was sent, since", () => {
  const store = memory();
  const held = { title: "A", body: "", prefixId: "" };
  writeThreadDraft(1, held, store);
  expect(sameDraft(readThreadDraft(1, store), held)).toBe(true);
  // Continued on the page of its own.
  writeThreadDraft(1, { title: "A", body: "and more", prefixId: "" }, store);
  expect(sameDraft(readThreadDraft(1, store), held)).toBe(false);
  // Sent there: nothing is kept, and what the hidden composer holds is stale.
  clearThreadDraft(1, store);
  expect(sameDraft(readThreadDraft(1, store), held)).toBe(false);
  // Nothing kept and nothing held are the same.
  expect(sameDraft(readThreadDraft(1, store), null)).toBe(true);
  expect(sameDraft(null, { title: " ", body: "", prefixId: "" })).toBe(true);
});

test("a draft with an attached file is the same one the tab holds: the tags are not kept, so they do not count", () => {
  const store = memory();
  const held = { title: "A", body: "hello [ATTACH]12[/ATTACH]", prefixId: "" };
  writeThreadDraft(1, held, store);
  expect(sameDraft(readThreadDraft(1, store), held)).toBe(true);
  // Only a tag held, nothing else: the same as nothing.
  expect(
    sameDraft(null, { title: "", body: "[ATTACH]12[/ATTACH]", prefixId: "" }),
  ).toBe(true);
  expect(
    sameDraft(
      { title: "A", body: "hello", prefixId: "" },
      { title: "A", body: "hello[ATTACH=full]3[/ATTACH]", prefixId: "" },
    ),
  ).toBe(true);
});

test("a composer is never drawn anew while its own send is on its way", () => {
  const typed = { title: "A", body: "text", prefixId: "" };
  // The send cleared the tab, so the held draft differs from what it holds...
  expect(draftMovedOn(null, typed, false)).toBe(true);
  // ...and that is no reason to unmount the composer that owns the request.
  expect(draftMovedOn(null, typed, true)).toBe(false);
  expect(draftMovedOn(typed, typed, false)).toBe(false);
});
