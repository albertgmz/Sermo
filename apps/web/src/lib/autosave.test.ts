import { expect, test } from "bun:test";
import {
  createAutosave,
  type Entries,
  isCleared,
  type SaveResult,
  type SaveState,
} from "@/lib/autosave";

// A clock the test moves by hand.
function clock() {
  let now = 0;
  let next = 0;
  const waiting = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      set: (run: () => void, ms: number) => {
        next += 1;
        waiting.set(next, { at: now + ms, run });
        return next;
      },
      clear: (id: unknown) => {
        waiting.delete(id as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...waiting]) {
        if (timer.at <= now) {
          waiting.delete(id);
          timer.run();
        }
      }
    },
    pending: () => waiting.size,
  };
}

function setting(initial: Entries, answer: () => Promise<SaveResult>) {
  const time = clock();
  const field = { entries: initial };
  const sent: Entries[] = [];
  const states: SaveState[] = [];
  const autosave = createAutosave({
    save: async (entries) => {
      sent.push(entries);
      return answer();
    },
    read: () => field.entries,
    write: (entries) => {
      field.entries = entries;
    },
    onState: (state) => states.push(state),
    timers: time.timers,
    delay: 1000,
    savedFor: 3000,
    undoFor: 6000,
  });
  autosave.baseline(initial);
  return { autosave, field, sent, states, time };
}

const tick = () => new Promise((done) => setTimeout(done, 0));

const ok = async (): Promise<SaveResult> => ({ ok: true });
const phases = (states: SaveState[]) => states.map((state) => state.phase);

test("typing saves once after the pause, and the saved state goes away by itself", async () => {
  const s = setting([["about", "Hi"]], ok);
  s.field.entries = [["about", "Hi t"]];
  s.autosave.edit();
  s.field.entries = [["about", "Hi there"]];
  s.time.advance(600);
  s.autosave.edit();
  s.time.advance(600);
  expect(s.sent).toEqual([]);
  s.time.advance(400);
  await tick();
  expect(s.sent).toEqual([[["about", "Hi there"]]]);
  expect(s.states).toEqual([
    { phase: "saving" },
    { phase: "saved", undo: false },
  ]);
  s.time.advance(3000);
  expect(s.states.at(-1)).toEqual({ phase: "idle" });
});

test("leaving the field saves at once, and an unchanged field saves nothing", async () => {
  const s = setting([["about", "Hi"]], ok);
  await s.autosave.flush();
  expect(s.sent).toEqual([]);
  s.field.entries = [["about", "Hello"]];
  s.autosave.edit();
  await s.autosave.flush();
  expect(s.sent).toEqual([[["about", "Hello"]]]);
  // The pause that was waiting is gone.
  s.time.advance(5000);
  await s.autosave.flush();
  expect(s.sent).toHaveLength(1);
});

test("a refusal shows the backend's words, keeps the text and is tried again on the next change", async () => {
  let answer: SaveResult = { error: "That is too long." };
  const s = setting([["about", ""]], async () => answer);
  s.field.entries = [["about", "x".repeat(9)]];
  await s.autosave.flush();
  expect(s.states.at(-1)).toEqual({
    phase: "error",
    message: "That is too long.",
  });
  expect(s.field.entries).toEqual([["about", "x".repeat(9)]]);
  // Nothing was learnt as saved, so the same text is sent again.
  answer = { ok: true };
  await s.autosave.flush();
  expect(s.sent).toHaveLength(2);
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: false });
});

test("a request that fails outright is an error with no message of its own", async () => {
  const s = setting([["about", ""]], async () => {
    throw new Error("offline");
  });
  s.field.entries = [["about", "a"]];
  await s.autosave.flush();
  expect(s.states.at(-1)).toEqual({ phase: "error", message: "" });
});

test("emptying a field that had text offers an undo that puts it back and saves it", async () => {
  const s = setting([["customTitle", "Captain"]], ok);
  s.field.entries = [["customTitle", ""]];
  await s.autosave.flush();
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: true });

  await s.autosave.undo();
  expect(s.field.entries).toEqual([["customTitle", "Captain"]]);
  expect(s.sent.at(-1)).toEqual([["customTitle", "Captain"]]);
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: false });
  // The undo is spent.
  await s.autosave.undo();
  expect(s.sent).toHaveLength(2);
});

test("the undo goes after a few seconds, and an ordinary change never offers one", async () => {
  const s = setting([["about", "Text"]], ok);
  s.field.entries = [["about", ""]];
  await s.autosave.flush();
  s.time.advance(5999);
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: true });
  s.time.advance(1);
  expect(s.states.at(-1)).toEqual({ phase: "idle" });
  await s.autosave.undo();
  expect(s.sent).toHaveLength(1);

  s.field.entries = [["about", "Other"]];
  await s.autosave.flush();
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: false });
});

test("a refused undo says why", async () => {
  let answer: SaveResult = { ok: true };
  const s = setting([["signature", "Bye"]], async () => answer);
  s.field.entries = [["signature", ""]];
  await s.autosave.flush();
  answer = { error: "A signature needs a perk." };
  await s.autosave.undo();
  expect(s.states.at(-1)).toEqual({
    phase: "error",
    message: "A signature needs a perk.",
  });
});

test("only one save runs at a time, and the latest text is sent after it", async () => {
  const release: (() => void)[] = [];
  const s = setting([["about", ""]], () => {
    return new Promise<SaveResult>((done) => {
      release.push(() => done({ ok: true }));
    });
  });
  s.field.entries = [["about", "a"]];
  const first = s.autosave.flush();
  s.field.entries = [["about", "ab"]];
  const second = s.autosave.flush();
  await tick();
  expect(s.sent).toEqual([[["about", "a"]]]);
  release[0]?.();
  await tick();
  release[1]?.();
  await Promise.all([first, second]);
  expect(s.sent).toEqual([[["about", "a"]], [["about", "ab"]]]);
  expect(phases(s.states)).toEqual(["saving", "saved", "saving", "saved"]);
});

test("a choice is saved exactly as made, even when it matches the last one", async () => {
  const s = setting([], ok);
  await s.autosave.saveNow([["value", "7"]]);
  await s.autosave.saveNow([["value", "7"]]);
  expect(s.sent).toEqual([[["value", "7"]], [["value", "7"]]]);
  expect(s.states.at(-1)).toEqual({ phase: "saved", undo: false });
});

test("disposing cancels what is waiting", () => {
  const s = setting([["about", ""]], ok);
  s.field.entries = [["about", "a"]];
  s.autosave.edit();
  expect(s.time.pending()).toBe(1);
  s.autosave.dispose();
  expect(s.time.pending()).toBe(0);
});

test("a setting is cleared when it had text and now has none", () => {
  expect(isCleared([["a", "x"]], [["a", " "]])).toBe(true);
  expect(isCleared([["a", ""]], [["a", ""]])).toBe(false);
  expect(isCleared([["a", "x"]], [["a", "y"]])).toBe(false);
  expect(
    isCleared(
      [
        ["day", "4"],
        ["month", "5"],
      ],
      [
        ["day", ""],
        ["month", ""],
      ],
    ),
  ).toBe(true);
  expect(
    isCleared(
      [
        ["day", "4"],
        ["month", "5"],
      ],
      [
        ["day", ""],
        ["month", "5"],
      ],
    ),
  ).toBe(false);
});

test("another kind of save goes through the same states and answers what it did", async () => {
  const s = setting([], ok);
  expect(await s.autosave.perform(async () => ({ ok: true }))).toEqual({
    ok: true,
  });
  expect(s.states).toEqual([
    { phase: "saving" },
    { phase: "saved", undo: false },
  ]);
  expect(
    await s.autosave.perform(async () => ({ error: "Too large." })),
  ).toEqual({ error: "Too large." });
  expect(s.states.at(-1)).toEqual({ phase: "error", message: "Too large." });
  expect(
    await s.autosave.perform(async () => {
      throw new Error("offline");
    }),
  ).toEqual({ error: "" });
  expect(s.sent).toEqual([]);
});
