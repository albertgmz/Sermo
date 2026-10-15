import { expect, test } from "bun:test";
import { quoteInbox } from "@/components/forum/lazy-quotes";

const EVENT = "thread:quote";

function setup(hasField = true) {
  const target = new EventTarget();
  const field = {
    value: "",
    caret: -1,
    focused: 0,
    setSelectionRange(start: number) {
      this.caret = start;
    },
    focus() {
      this.focused += 1;
    },
  };
  const log = { changed: [] as string[], loads: 0 };
  const deferred: (() => void)[] = [];
  const seen: string[] = [];
  target.addEventListener(EVENT, (e) =>
    seen.push(String((e as CustomEvent<string>).detail)),
  );
  const state = { present: hasField };
  const inbox = quoteInbox({
    event: EVENT,
    target,
    field: () => (state.present ? field : null),
    onFilled: (text) => log.changed.push(text),
    load: () => {
      log.loads += 1;
    },
    defer: (run) => deferred.push(run),
  });
  const quote = (detail: string) =>
    target.dispatchEvent(new CustomEvent(EVENT, { detail }));
  // The events the editor would get: the inbox's own listener comes first, so `seen` counts every
  // dispatch, including the ones the inbox makes itself.
  const flush = () => {
    for (const run of deferred.splice(0)) run();
  };
  return { field, log, inbox, quote, flush, seen, state };
}

test("an event fills the plain field, moves the caret to its end, focuses it and asks for the editor", () => {
  const s = setup();
  s.quote("> q");
  expect(s.field.value).toBe("> q\n\n");
  expect(s.field.caret).toBe(s.field.value.length);
  expect(s.field.focused).toBe(1);
  expect(s.log.changed).toEqual(["> q\n\n"]);
  expect(s.log.loads).toBe(1);
});

test("a second quote goes below the first and below what was typed", () => {
  const s = setup();
  s.field.value = "typed  ";
  s.quote("> one");
  s.quote("> two");
  expect(s.field.value).toBe("typed\n\n> one\n\n> two\n\n");
  expect(s.log.changed.length).toBe(2);
});

test("a quote that arrives with no plain field is held and replayed once, after the editor is ready", () => {
  const s = setup(false);
  s.quote("> held");
  expect(s.field.value).toBe("");
  expect(s.log.loads).toBe(0);
  s.inbox.ready();
  // Nothing is sent before the delay: the editor is not listening yet.
  expect(s.seen).toEqual(["> held"]);
  s.flush();
  expect(s.seen).toEqual(["> held", "> held"]);
  // The replay reaches the inbox, which now ignores it, and nothing is queued again.
  s.flush();
  s.inbox.ready();
  s.flush();
  expect(s.seen).toEqual(["> held", "> held"]);
  expect(s.field.value).toBe("");
});

test("an event after the editor is ready is left to the editor", () => {
  const s = setup();
  s.inbox.ready();
  s.quote("> late");
  expect(s.field.value).toBe("");
  expect(s.log.changed).toEqual([]);
  expect(s.log.loads).toBe(0);
});

test("a quote in the text the editor opened with is followed by an empty one, so the caret leaves the quote block", () => {
  const s = setup();
  s.quote("> q");
  s.inbox.ready();
  s.flush();
  expect(s.seen).toEqual(["> q", ""]);
});

test("with no quote in the text, nothing is sent when the editor is ready", () => {
  const s = setup();
  s.inbox.ready();
  s.flush();
  expect(s.seen).toEqual([]);
});

test("after detach the inbox hears nothing", () => {
  const s = setup();
  s.inbox.detach();
  s.quote("> q");
  expect(s.field.value).toBe("");
});
