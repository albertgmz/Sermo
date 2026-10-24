import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { POLL_MS } from "@/lib/poll-intervals";
import {
  POLL_IDLE_STOP_MS,
  POLL_MAX_INTERVAL_MS,
  pollDelay,
} from "@/lib/polling";

const source = (path: string) =>
  readFileSync(join(import.meta.dir, "..", "src", path), "utf8");

test("the intervals are the ones the backend's reads were sized for", () => {
  expect(POLL_MS).toEqual({
    messages: 3_000,
    thread: 10_000,
    feed: 30_000,
    counters: 60_000,
  });
  const perMinute = (ms: number) => 60_000 / ms;
  // 20 + 6 + 2 + 1: the 29 requests a minute the since reads were measured at, which is more than
  // one tab does (it shows one of the first three and the counters).
  expect(
    perMinute(POLL_MS.messages) +
      perMinute(POLL_MS.thread) +
      perMinute(POLL_MS.feed) +
      perMinute(POLL_MS.counters),
  ).toBe(29);
});

test("a failing poll waits at most a minute, and a visitor away for ten minutes is not polled", () => {
  expect(POLL_MAX_INTERVAL_MS).toBe(60_000);
  expect(POLL_IDLE_STOP_MS).toBe(10 * 60_000);
  expect(pollDelay(10, { intervalMs: POLL_MS.messages })).toBe(60_000);
});

test("every poll is a server action that makes one backend call without settling the visitor first", () => {
  for (const file of [
    "app/[locale]/(main)/conversations/poll-messages.ts",
    "app/[locale]/(main)/threads/poll-posts.ts",
    "components/layout/counters-action.ts",
  ]) {
    const code = source(file);
    expect(code, file).toContain('"use server"');
    expect(code, file).toContain("callForPoll(");
    expect(code, file).toContain("pollQuietly");
    expect(code, file).not.toMatch(/\bcall\(|\bread\(|getViewer\(/);
  }
  const feed = source("app/[locale]/(main)/_feed/feed-actions.ts");
  expect(feed).toMatch(/pollQuietly\(\(\) =>\s+callForPoll\(feedNewCount/);
});

test("the polling screens use the one hook, at their interval", () => {
  const tail = source("components/forum/live-tail.tsx");
  expect(tail).toContain("usePolling(");
  expect(tail).toContain("{ intervalMs }");
  expect(source("components/forum/infinite-list.tsx")).toContain("usePolling(");
  expect(source("components/layout/counters-poll.tsx")).toContain(
    "intervalMs: POLL_MS.counters",
  );
  expect(
    source("app/[locale]/(main)/conversations/[id]/messages-region.tsx"),
  ).toContain("intervalMs={POLL_MS.messages}");
  expect(source("app/[locale]/(main)/threads/[id]/thread-posts.tsx")).toContain(
    "intervalMs={POLL_MS.thread}",
  );
  expect(source("app/[locale]/(main)/novedades/page.tsx")).toContain(
    "intervalMs: POLL_MS.feed",
  );
});

test("nothing polls with a timer of its own", () => {
  for (const file of [
    "components/forum/live-tail.tsx",
    "components/forum/infinite-list.tsx",
    "components/layout/counters-poll.tsx",
    "lib/tail.ts",
  ]) {
    expect(source(file), file).not.toMatch(/setInterval|setTimeout/);
  }
});

test("the thread asks again only for the last page, and the counters only for a signed-in member", () => {
  const thread = source("app/[locale]/(main)/threads/[id]/thread-posts.tsx");
  expect(thread).toMatch(/page >= pages/);
  expect(thread).toContain("!cursor");
  expect(source("app/[locale]/(main)/layout.tsx")).toMatch(
    /user && <CountersPoll/,
  );
});

test("the feed asks for new entries on the tabs that can have them, and the badges read one value", () => {
  expect(source("app/[locale]/(main)/novedades/page.tsx")).toMatch(
    /tab === "hot"\s*\?\s*undefined/,
  );
  for (const file of [
    "components/layout/inbox-panel.tsx",
    "components/layout/mobile-nav.tsx",
  ]) {
    expect(source(file), file).toContain("useCounter(");
  }
});
