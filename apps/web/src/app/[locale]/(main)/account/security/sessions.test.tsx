import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

// A device login (a terminal client such as sermo-cli) is listed with the browser sessions, named
// by its client and host, marked as a terminal client, and can be ended on its own.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));

const { Sessions } = await import("./sessions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const session = (id: string) => ({
  id,
  token: `token-${id}`,
  createdAt: "2026-10-01T00:00:00.000Z",
  expiresAt: "2026-12-30T00:00:00.000Z",
  ipAddress: null,
  userAgent: null,
});

// A session whose user agent says nothing the detector knows.
const UNKNOWN = {
  browser: null,
  browserCode: null,
  browserVersion: null,
  os: null,
  osCode: null,
  osVersion: null,
  osFamily: null,
  deviceType: null,
  brand: null,
  brandCode: null,
  model: null,
  isBot: false,
};

function backend() {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/auth/list-sessions")
      return Response.json([session("1"), session("2")]);
    if (pathname === "/api/auth/get-session")
      return Response.json({
        session: { id: "1" },
        user: { email: "nora@example.test", emailVerified: true },
      });
    if (pathname === "/api/v1/me/session-devices")
      return Response.json({
        items: [
          {
            sessionId: 2,
            ipAddress: null,
            device: UNKNOWN,
            location: null,
            lastActiveAt: null,
            terminalClient: "sermo-cli · work-laptop",
          },
          {
            sessionId: 1,
            ipAddress: null,
            device: UNKNOWN,
            location: null,
            lastActiveAt: null,
          },
        ],
      });
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;
}

test("a device login is listed by its client and host, as a terminal client, with its own revoke", async () => {
  backend();
  const html = await new Response(
    await renderToReadableStream(
      withIntl(await Sessions({ searchParams: Promise.resolve({}) })),
    ),
  ).text();
  expect(html).toContain("sermo-cli · work-laptop");
  expect(html.match(/Terminal client/g)).toHaveLength(1);
  // The current browser session has no revoke button; the device login has one.
  expect(html.match(/name="session" value="2"/g)).toHaveLength(1);
  expect(html).not.toContain('name="session" value="1"');
});
