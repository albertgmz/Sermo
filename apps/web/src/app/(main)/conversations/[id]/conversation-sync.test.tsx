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

const { ConversationSync } = await import("./conversation-sync");

afterAll(() => {
  mock.module("react", () => react);
  mock.module("next/navigation", () => navigation);
});

function render(unread: boolean) {
  effects.length = 0;
  marked.length = 0;
  refreshed = 0;
  renderToStaticMarkup(createElement(ConversationSync, { id: 5, unread }));
  return effects.map((effect) => effect());
}

test("an unread conversation is marked read and the route is refreshed once that is done", async () => {
  render(true);
  expect(marked).toEqual([5]);
  expect(refreshed).toBe(0);
  await Promise.resolve();
  await Promise.resolve();
  expect(refreshed).toBe(1);
});

test("a conversation that is already read is neither marked nor refreshed", async () => {
  render(false);
  await Promise.resolve();
  expect(marked).toEqual([]);
  expect(refreshed).toBe(0);
});

test("leaving the page before the answer comes back refreshes nothing", async () => {
  const cleanups = render(true);
  for (const cleanup of cleanups) cleanup?.();
  await Promise.resolve();
  await Promise.resolve();
  expect(refreshed).toBe(0);
});
