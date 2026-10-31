import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { siteBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

// The email section shows whether the address is confirmed only while the site asks members to
// confirm it. A site that asks nothing shows neither badge, nor the link to send again.

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

const { EmailSection } = await import("./sections");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

/** The backend: a member with the address state given, on a site that sends mail. */
function backend(emailVerified: boolean, confirmEmail: boolean) {
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/auth/get-session")
      return Response.json({
        session: { id: "1" },
        user: { email: "nora@example.test", emailVerified },
      });
    if (pathname === "/api/auth/send-verification-email")
      return Response.json({ status: true });
    if (pathname === "/api/v1/site")
      return Response.json(siteBody({ confirmEmail }));
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;
}

const draw = async () =>
  new Response(
    await renderToReadableStream(
      withIntl(await EmailSection({ searchParams: Promise.resolve({}) })),
    ),
  ).text();

test("while the site asks no email confirmation, the address shows no badge and no link to send again", async () => {
  for (const verified of [false, true]) {
    backend(verified, false);
    const html = await draw();
    expect(html).toContain("nora@example.test");
    expect(html).not.toContain("Not confirmed");
    expect(html).not.toContain(">Confirmed<");
    expect(html).not.toContain("Send the confirmation link again");
    expect(html).toContain("Change email");
  }
});

test("while the site asks for email confirmation, an unconfirmed address says so and offers the link again", async () => {
  backend(false, true);
  const html = await draw();
  expect(html).toContain("Not confirmed");
  expect(html).toContain("Send the confirmation link again");
  backend(true, true);
  const confirmed = await draw();
  expect(confirmed).toContain(">Confirmed<");
  expect(confirmed).not.toContain("Send the confirmation link again");
});
