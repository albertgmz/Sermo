import { expect, test } from "bun:test";
import { joinHost } from "@/lib/join-host";
import type { JoinAsk } from "@/lib/join-window";

// How the page's sign-up window opens: through the site's lazy-popup path, so a press before its
// code has arrived waits for it (busy), a dropped request is tried again, and code that cannot be
// fetched sends the guest to the log-in page the link named instead of swallowing the press.

const ask: JoinAsk = { reason: "react", next: "/threads/3?page=2" };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function record(load: () => Promise<{ default: unknown }>) {
  const shown: JoinAsk[] = [];
  const followed: string[] = [];
  const busy: boolean[] = [];
  const host = joinHost(load, {
    show: (next) => shown.push(next),
    follow: (href) => followed.push(href),
  });
  return { host, shown, followed, busy };
}

test("a press opens the window once its code is there, saying it is busy meanwhile", async () => {
  const { host, shown, followed, busy } = record(async () => ({
    default: () => null,
  }));
  host.open(ask, (waiting) => busy.push(waiting));
  expect(shown).toEqual([]);
  await settle();
  expect(shown).toEqual([ask]);
  expect(followed).toEqual([]);
  expect(busy).toEqual([true, false]);
});

test("a dropped request is tried once more", async () => {
  let calls = 0;
  const { host, shown } = record(async () => {
    calls += 1;
    if (calls === 1) throw new Error("dropped");
    return { default: () => null };
  });
  host.open(ask);
  await settle();
  await settle();
  expect(calls).toBe(2);
  expect(shown).toEqual([ask]);
});

test("code that cannot be fetched sends the guest to the log-in page instead", async () => {
  const { host, shown, followed } = record(async () => {
    throw new Error("offline");
  });
  host.open(ask);
  await settle();
  await settle();
  expect(shown).toEqual([]);
  expect(followed).toEqual(["/login?next=%2Fthreads%2F3%3Fpage%3D2"]);
});
