import { expect, test } from "bun:test";
import { consentCallbacks, mustReloadForQuiet } from "./callbacks";

// The banner library as the callbacks see it, and what the page is told to do.
function setup(
  quiet: boolean,
  accepted: string[] | null,
  omit: string[] = [],
  gpc = false,
) {
  const done: string[] = [];
  const timers: (() => void)[] = [];
  const callbacks = consentCallbacks({
    quiet,
    gpc,
    omit: omit as never,
    library: async () =>
      accepted === null
        ? null
        : {
            getUserPreferences: () => ({ acceptedCategories: accepted }),
            setCookieData: (data) => {
              done.push(`data ${JSON.stringify(data)}`);
              return true;
            },
          },
    save: () => done.push("save"),
    reload: () => done.push("reload"),
    refresh: () => done.push("refresh"),
    later: (run) => timers.push(run),
  });
  const first = () => callbacks.onFirstConsent?.({} as never);
  const change = (...changedCategories: string[]) =>
    callbacks.onChange?.({ changedCategories } as never);
  return { done, timers, first, change };
}

test("every choice is sent to be saved on the account, the first and the later ones", async () => {
  const w = setup(false, ["necessary", "embeds"]);
  await w.first();
  await w.change("embeds");
  expect(w.done.filter((step) => step === "save")).toHaveLength(2);
});

test("a first choice that accepts something refreshes the page; one that accepts nothing leaves it", async () => {
  const some = setup(false, ["necessary", "embeds"]);
  await some.first();
  expect(some.done).toEqual(["save", "refresh"]);
  const none = setup(false, ["necessary"]);
  await none.first();
  expect(none.done).toEqual(["save"]);
});

test("a later change reloads for a withdrawal of the tag or the players, refreshes for an acceptance", async () => {
  const withdrawn = setup(false, ["necessary"]);
  await withdrawn.change("analytics");
  expect(withdrawn.done).toEqual(["save", "reload"]);
  const accepted = setup(false, ["necessary", "analytics"]);
  await accepted.change("analytics");
  expect(accepted.done).toEqual(["save", "refresh"]);
});

test("a visitor who was not asked: the first choice is the only event even when the library reports a change too", async () => {
  // In opt-out mode the library calls both, in the same turn, when something differs.
  const w = setup(true, ["necessary", "embeds"]);
  await Promise.all([w.first(), w.change("analytics", "referrals")]);
  expect(w.done).toEqual(["save", "reload"]);
  // Once the turn is over a real change counts again.
  for (const run of w.timers) run();
  await w.change("embeds");
  expect(w.done.filter((step) => step === "save")).toHaveLength(2);
});

test("outside the quiet mode a change after the first choice is never swallowed", async () => {
  const w = setup(false, ["necessary", "embeds"]);
  await Promise.all([w.first(), w.change("embeds")]);
  expect(w.done.filter((step) => step === "save")).toHaveLength(2);
});

test("a visitor who was not asked and keeps everything on needs no new page; turning the tag off reloads", async () => {
  const keeps = setup(true, ["necessary", "analytics", "referrals", "embeds"]);
  await keeps.first();
  expect(keeps.done).toEqual(["save"]);
  const offers = setup(
    true,
    ["necessary", "referrals", "embeds"],
    ["analytics"],
  );
  await offers.first();
  expect(offers.done).toEqual(["save"]);
  const off = setup(true, ["necessary", "referrals", "embeds"]);
  await off.first();
  expect(off.done).toEqual(["save", "reload"]);
});

test("without the library the choice is still sent and nothing else happens", async () => {
  const w = setup(false, null);
  await w.first();
  await w.change("analytics");
  expect(w.done).toEqual(["save", "save"]);
});

test("a page started for a visitor who was not asked is loaded again once they are one who is", () => {
  // A guest outside Europe signs in by a soft navigation: the server now says "asked".
  expect(mustReloadForQuiet(true, false)).toBe(true);
  expect(mustReloadForQuiet(true, true)).toBe(false);
  expect(mustReloadForQuiet(false, false)).toBe(false);
  // The other way needs nothing: a started banner already asks.
  expect(mustReloadForQuiet(false, true)).toBe(false);
});

test("under Global Privacy Control every choice is marked as made after the signal, before the page is drawn again", async () => {
  const mark = `data ${JSON.stringify({ value: { gpc: true }, mode: "update" })}`;
  const w = setup(false, ["necessary", "embeds"], [], true);
  await w.first();
  expect(w.done).toEqual(["save", mark, "refresh"]);
  await w.change("embeds");
  expect(w.done.slice(3)).toEqual(["save", mark, "refresh"]);
  // Without the signal nothing is written beside the choice.
  const plain = setup(false, ["necessary", "embeds"]);
  await plain.first();
  expect(plain.done).toEqual(["save", "refresh"]);
});

test("a visitor who was not asked but sends Global Privacy Control started with nothing on: accepting is drawn, a change is not swallowed", async () => {
  const mark = `data ${JSON.stringify({ value: { gpc: true }, mode: "update" })}`;
  const all = setup(
    true,
    ["necessary", "analytics", "referrals", "embeds"],
    [],
    true,
  );
  await all.first();
  expect(all.done).toEqual(["save", mark, "refresh"]);
  const none = setup(true, ["necessary"], [], true);
  await none.first();
  expect(none.done).toEqual(["save", mark]);
  // The library is in its opt-in mode: a change in the same turn is a real one.
  const both = setup(true, ["necessary", "embeds"], [], true);
  await Promise.all([both.first(), both.change("embeds")]);
  expect(both.done.filter((step) => step === "save")).toHaveLength(2);
});
