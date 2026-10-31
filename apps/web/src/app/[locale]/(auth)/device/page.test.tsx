import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { siteBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let cookie = "sermo.session_token=abc";
mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => {
    const t = (key: string) => key;
    t.rich = (key: string) => key;
    return t;
  },
}));

const { default: DevicePage } = await import("./page");
const { decideDevice } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

type Asked = {
  method: string;
  path: string;
  cookie: string | null;
  body: unknown;
};

// The backend: auth.me for a member or a guest, and Better Auth's device endpoints.
function backend(
  user: "member" | "guest",
  device: () => Response = () =>
    Response.json({
      user_code: "ABCD2345",
      status: "pending",
      client_id: "sermo-cli",
    }),
) {
  const asked: Asked[] = [];
  globalThis.fetch = (async (input: string, init: RequestInit = {}) => {
    const { pathname, search } = new URL(input);
    asked.push({
      method: init.method ?? "GET",
      path: `${pathname}${search}`,
      cookie: new Headers(init.headers).get("cookie"),
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (pathname === "/api/v1/site") return Response.json(siteBody());
    if (pathname === "/api/v1/me")
      return Response.json(viewerBody(user === "member"));
    if (pathname.startsWith("/api/auth/device")) return device();
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  return asked;
}

const page = (params: Record<string, string> = {}) =>
  DevicePage({ searchParams: Promise.resolve(params) } as never);

async function redirectOf(run: () => Promise<unknown>) {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest);
    if (!digest.startsWith("NEXT_REDIRECT")) throw error;
    return digest.split(";")[2];
  }
}

// The value of every hidden field of every form in a drawn tree, form by form.
function formsOf(node: unknown): Record<string, string>[] {
  if (node === null || typeof node !== "object") return [];
  const element = node as ReactElement<Record<string, unknown>>;
  const children = [element.props?.children].flat(Infinity);
  if (element.type === "form") {
    const fields: Record<string, string> = {};
    const collect = (child: unknown) => {
      if (child === null || typeof child !== "object") return;
      const inner = child as ReactElement<Record<string, unknown>>;
      if (inner.type === "input" && inner.props.type === "hidden")
        fields[String(inner.props.name)] = String(inner.props.value);
      for (const next of [inner.props?.children].flat(Infinity)) collect(next);
    };
    for (const child of children) collect(child);
    return [fields];
  }
  return children.flatMap(formsOf);
}

const headingOf = (node: unknown) =>
  (node as ReactElement<{ heading?: string }>).props.heading;

test("without a code the page asks for one", async () => {
  backend("member");
  expect(headingOf(await page())).toBe("heading");
});

test("a visitor who is not signed in signs in first and comes back to the code", async () => {
  cookie = "";
  backend("guest");
  expect(await redirectOf(() => page({ user_code: "ABCD2345" }))).toBe(
    "/login?next=%2Fdevice%3Fuser_code%3DABCD2345",
  );
  cookie = "sermo.session_token=abc";
});

test("a member sees the request with the code, and can approve or deny it", async () => {
  const asked = backend("member");
  const tree = await page({ user_code: "ABCD2345" });
  expect(headingOf(tree)).toBe("requestHeading");
  // The request was read for the member's session, which claims the code for them.
  expect(asked).toContainEqual({
    method: "GET",
    path: "/api/auth/device?user_code=ABCD2345",
    cookie: "sermo.session_token=abc",
    body: null,
  });
  expect(formsOf(tree)).toEqual([
    { user_code: "ABCD2345", choice: "deny" },
    { user_code: "ABCD2345", choice: "approve" },
  ]);
});

test("an unknown or expired code, or one another account opened, cannot be approved", async () => {
  backend("member", () =>
    Response.json(
      { error: "expired_token", error_description: "x" },
      { status: 400 },
    ),
  );
  const expired = await page({ user_code: "ABCD2345" });
  expect(headingOf(expired)).toBe("invalidHeading");
  backend("member", () =>
    Response.json({ user_code: "ABCD2345", status: "pending" }),
  );
  expect(headingOf(await page({ user_code: "ABCD2345" }))).toBe(
    "invalidHeading",
  );
  backend("member", () =>
    Response.json({
      user_code: "ABCD2345",
      status: "approved",
      client_id: "sermo-cli",
    }),
  );
  expect(headingOf(await page({ user_code: "ABCD2345" }))).toBe(
    "invalidHeading",
  );
});

test("the answer is shown once it is given", async () => {
  backend("member");
  expect(headingOf(await page({ result: "approved" }))).toBe("approvedHeading");
  expect(headingOf(await page({ result: "denied" }))).toBe("deniedHeading");
});

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("approving and denying send the member's answer to the backend", async () => {
  let asked = backend("member", () => Response.json({ success: true }));
  expect(
    await redirectOf(() =>
      decideDevice(form({ user_code: "ABCD2345", choice: "approve" })),
    ),
  ).toBe("/device?result=approved");
  expect(asked.at(-1)).toMatchObject({
    method: "POST",
    path: "/api/auth/device/approve",
    body: { userCode: "ABCD2345" },
  });
  asked = backend("member", () => Response.json({ success: true }));
  expect(
    await redirectOf(() =>
      decideDevice(form({ user_code: "ABCD2345", choice: "deny" })),
    ),
  ).toBe("/device?result=denied");
  expect(asked.at(-1)?.path).toBe("/api/auth/device/deny");
});

test("a refused answer goes back to the code, which says it failed", async () => {
  backend("member", () =>
    Response.json(
      { error: "expired_token", error_description: "x" },
      { status: 400 },
    ),
  );
  expect(
    await redirectOf(() =>
      decideDevice(form({ user_code: "ABCD2345", choice: "approve" })),
    ),
  ).toBe("/device?user_code=ABCD2345&failed=1");
});

test("the page imports no client component, so it ships no JavaScript of its own", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = join(import.meta.dir, "../../../..");
  for (const file of ["page.tsx", "actions.ts"]) {
    const source = readFileSync(join(import.meta.dir, file), "utf8");
    for (const [, path] of source.matchAll(/from "@\/([^"]+)"/g)) {
      const found = [".tsx", ".ts"]
        .map((ext) => join(src, `${path}${ext}`))
        .find((candidate) => existsSync(candidate));
      if (!found) continue;
      const head = readFileSync(found, "utf8").trimStart();
      expect({ path, client: head.startsWith('"use client"') }).toEqual({
        path,
        client: false,
      });
    }
  }
});
