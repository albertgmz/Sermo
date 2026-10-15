import { afterEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {} }),
}));

const { ShortcutsGate } = await import("./shortcuts-gate");
const { LazyShortcuts } = await import("./shortcuts-lazy");

function backend(body: unknown) {
  globalThis.fetch = (async () =>
    Response.json(body)) as unknown as typeof fetch;
}

async function enabled() {
  const element = await ShortcutsGate();
  expect(element.type).toBe(LazyShortcuts);
  return (element.props as { enabled: boolean }).enabled;
}

test("a member who keeps the shortcuts on has them", async () => {
  backend(viewerBody(true));
  expect(await enabled()).toBe(true);
});

test("a member who turned the shortcuts off has none", async () => {
  const body = viewerBody(true);
  backend({ ...body, user: { ...body.user, keyboardShortcuts: false } });
  expect(await enabled()).toBe(false);
});

test("a guest has the shortcuts on", async () => {
  backend(viewerBody(false));
  expect(await enabled()).toBe(true);
});
