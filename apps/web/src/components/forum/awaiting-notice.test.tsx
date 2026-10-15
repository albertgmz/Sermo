import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { AwaitingNotice, AwaitingStrip } = await import("./awaiting-notice");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

function viewer(awaitingApproval: boolean | null) {
  globalThis.fetch = (async () =>
    Response.json(
      awaitingApproval === null
        ? viewerBody(false)
        : {
            ...viewerBody(true),
            user: { ...viewerBody(true).user, awaitingApproval },
          },
    )) as unknown as typeof fetch;
}

async function draw() {
  const notice = await AwaitingNotice();
  return notice ? renderToStaticMarkup(await AwaitingStrip()) : "";
}

test("an account waiting for approval is told so, in words that say what it can still do", async () => {
  viewer(true);
  const markup = await draw();
  expect(markup).toContain(messages.layout.awaitingNotice.title);
  expect(markup).toContain(
    "Your account is waiting for staff to approve it. You can read the forum like a guest until then.",
  );
  expect(markup).toContain(
    `aria-label="${messages.layout.awaitingNotice.label}"`,
  );
  // Both themes: the strip takes the muted surface and the foreground of the theme, no colour of its own.
  expect(markup).toContain("bg-muted");
  expect(markup).not.toMatch(/#[0-9a-f]{3,8}|rgb\(|text-white|text-black/i);
});

test("an approved member and a guest are shown nothing", async () => {
  viewer(false);
  expect(await AwaitingNotice()).toBeNull();
  viewer(null);
  expect(await AwaitingNotice()).toBeNull();
});
