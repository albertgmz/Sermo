import { afterEach, beforeEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { viewerBody } from "@/lib/test-viewer";
import layout from "../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
function requestCookie(cookie: string) {
  mock.module("next/headers", () => ({
    headers: async () => new Headers({ cookie }),
    cookies: async () => ({ set: () => {} }),
  }));
}
// A signed-in visitor unless a test says otherwise.
beforeEach(() => {
  requestCookie("sermo.session_token=live");
});
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.sessionNotice as Record<string, string>)[key],
}));

const { SessionNotice } = await import("./session-notice");

test("the notice is the one line the shell shows when the session could not be confirmed", async () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "internal", message: "Broken" } },
      { status: 500 },
    )) as unknown as typeof fetch;
  try {
    const notice = (await SessionNotice()) as {
      props: { children: string; role: string };
    } | null;
    assert.equal(notice?.props.role, "status");
    assert.equal(
      notice?.props.children,
      "The site could not confirm your session; some things may be missing. Reload to try again.",
    );
  } finally {
    quiet.mockRestore();
  }
});

test("there is no notice when the backend answered about the session", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      {
        error: { code: "unauthenticated", message: "No" },
      },
      { status: 401 },
    )) as unknown as typeof fetch;
  // A dead cookie is asked again as a guest; the second answer is the guest's.
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? Response.json(
          { error: { code: "unauthenticated", message: "No" } },
          { status: 401 },
        )
      : Response.json(viewerBody(false));
  }) as unknown as typeof fetch;
  assert.equal(await SessionNotice(), null);
});

test("a visitor with no session, when the backend cannot be reached, gets the line about the site", async () => {
  const quiet = spyOn(console, "error").mockImplementation(() => {});
  requestCookie("theme=dark");
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  try {
    const notice = (await SessionNotice()) as {
      props: { children: string };
    } | null;
    assert.equal(
      notice?.props.children,
      "The site could not be reached right now; some things may be missing. Reload to try again.",
    );
  } finally {
    quiet.mockRestore();
  }
});
