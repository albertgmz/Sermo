import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { confirmNotMe } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend(response: () => Response) {
  const asked: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return response();
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

const TOKEN = "payload.signature-0123456789";

test("the token is sent to the backend and the member is taken to log in and change the password", async () => {
  const asked = backend(() => Response.json({ revoked: 2 }));
  const to = await redirectedTo(() =>
    confirmNotMe(null, form({ token: TOKEN })),
  );
  expect(asked.some((call) => call.url.endsWith("/api/v1/not-me"))).toBe(true);
  expect(
    asked.find((call) => call.url.endsWith("/api/v1/not-me"))?.body,
  ).toEqual({
    token: TOKEN,
  });
  expect(to).toContain("/login?notMe=1&next=%2Faccount%2Fsecurity%23password");
});

test("a link that was used or has expired lands on the page that explains it", async () => {
  backend(() =>
    Response.json(
      { error: { code: "validation", message: "Expired or invalid link." } },
      { status: 400 },
    ),
  );
  const to = await redirectedTo(() =>
    confirmNotMe(null, form({ token: TOKEN })),
  );
  expect(to).toContain("/not-me?error=INVALID_TOKEN");
});

test("no token asks nothing of the backend", async () => {
  const asked = backend(() => Response.json({ revoked: 0 }));
  const to = await redirectedTo(() => confirmNotMe(null, form({})));
  expect(to).toContain("/not-me");
  expect(asked.some((call) => call.url.endsWith("/api/v1/not-me"))).toBe(false);
});
