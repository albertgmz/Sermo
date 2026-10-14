import { afterAll, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// A server render never runs effects, so they are collected and run by hand.
const react = await import("react");
const navigation = await import("next/navigation");
const effects: (() => (() => void) | undefined)[] = [];
mock.module("react", () => ({
  ...react,
  useEffect: (effect: () => (() => void) | undefined) => {
    effects.push(effect);
  },
}));
let refreshed = 0;
mock.module("next/navigation", () => ({
  useRouter: () => ({
    refresh: () => {
      refreshed += 1;
    },
  }),
}));
const marked: number[] = [];
mock.module("@/app/(main)/conversations/actions", () => ({
  markRead: async (id: number) => {
    marked.push(id);
  },
}));

const { ConversationSync, keepsPlace } = await import("./conversation-sync");

afterAll(() => {
  mock.module("react", () => react);
  mock.module("next/navigation", () => navigation);
});

// The scroll effect reads the address of the page, which a server render has not got.
function render() {
  const globals = globalThis as unknown as { window?: unknown };
  globals.window = { location: { hash: "" } };
  effects.length = 0;
  marked.length = 0;
  refreshed = 0;
  renderToStaticMarkup(createElement(ConversationSync, { id: 5 }));
  try {
    return effects.map((effect) => effect());
  } finally {
    delete globals.window;
  }
}

test("opening a conversation marks it read and refreshes the route once that is done", async () => {
  render();
  expect(marked).toEqual([5]);
  expect(refreshed).toBe(0);
  await Promise.resolve();
  await Promise.resolve();
  expect(refreshed).toBe(1);
});

test("leaving the page before the answer comes back refreshes nothing", async () => {
  const cleanups = render();
  for (const cleanup of cleanups) cleanup?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(refreshed).toBe(0);
});

test("an address that names a message keeps the page at that message", () => {
  expect(keepsPlace("#message-4")).toBe(true);
  for (const hash of ["", "#post-4", "#main"])
    expect(keepsPlace(hash)).toBe(false);
});
