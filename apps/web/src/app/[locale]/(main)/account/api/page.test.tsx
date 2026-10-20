import { afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
const server = await import("next/server");
mock.module("next/server", () => ({ ...server, connection: async () => {} }));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
}));
mock.module("@/app/[locale]/(main)/account/api/actions", () => ({
  issueKey: async () => null,
  revokeKey: async () => null,
}));

const { KeySection } = await import("./keys");
const { ApiIntro, KeyWarning } = await import("./intro");

afterEach(() => {
  globalThis.fetch = realFetch;
});

const text = messages.account.apiKeys;

function listing(keys: unknown[], status = 200) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
    return Response.json(
      status === 200 ? { apiKeys: keys, total: keys.length } : {},
      { status },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function markup(element: React.ReactNode) {
  const stream = await renderToReadableStream(withIntl(element));
  await stream.allReady;
  return new Response(stream).text();
}

const key = (id: number, name: string | null) => ({
  id,
  name,
  createdAt: "2026-10-01T10:00:00.000Z",
  start: "sermo_",
});

test("with no key the member is offered to create one, with their password", async () => {
  const asked = listing([]);
  const html = await markup(await KeySection());
  expect(asked[0]).toBe(
    "http://127.0.0.1:8787/api/auth/api-key/list?sortBy=createdAt&sortDirection=asc",
  );
  expect(html).toContain(text.key.none);
  expect(html).toContain(text.key.create);
  expect(html).toContain('name="actorPassword"');
  expect(html).not.toContain('name="replace"');
  expect(html).not.toContain(text.key.revoke);
});

test("with a key its name and date show, with revoke and replace", async () => {
  listing([key(4, "mcp-client")]);
  const html = await markup(await KeySection());
  expect(html).toContain("mcp-client");
  expect(html).toContain('dateTime="2026-10-01T10:00:00.000Z"');
  expect(html).toContain("Oct 1, 2026");
  expect(html).toContain(text.key.revoke);
  expect(html).toContain('name="key" value="4"');
  expect(html).toContain(text.key.replace);
  expect(html).toContain(text.key.replaceWarning);
  expect(html).toContain('name="replace" value="1"');
  expect(html).not.toContain(text.key.create);
  expect(html).not.toContain(text.key.none);
});

test("a key without a name is the personal key", async () => {
  listing([key(4, null)]);
  expect(await markup(await KeySection())).toContain(text.key.unnamed);
});

test("keys made before the one-key rule are each listed with their own revoke", async () => {
  listing([key(4, "a"), key(5, "b"), key(6, "c")]);
  const html = await markup(await KeySection());
  expect(html).toContain("You have 3 keys from before the one-key rule");
  for (const id of [4, 5, 6])
    expect(html).toContain(`name="key" value="${id}"`);
  expect(html).toContain(text.key.replaceSeveralWarning);
});

test("a listing that fails says so and offers nothing to press", async () => {
  listing([], 500);
  const html = await markup(await KeySection());
  expect(html).toContain(text.key.failed);
  expect(html).not.toContain('name="actorPassword"');
});

test("the page says what a key is for, links the reference and warns before the key", async () => {
  const html = await markup(
    <>
      <ApiIntro />
      <KeyWarning />
    </>,
  );
  expect(html).toContain('href="/developer"');
  expect(html).toContain("http://localhost:3000/mcp");
  expect(html).toContain(text.warning.heading);
  expect(html).toContain("can read your private conversations");
});
