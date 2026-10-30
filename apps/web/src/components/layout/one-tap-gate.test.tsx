import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { siteBody } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

let cookie = "";
mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(cookie ? { cookie } : {}),
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...intl,
  getLocale: async () => "es",
}));

const { OneTapGate } = await import("./one-tap-gate");
const { OneTap } = await import("./one-tap");

afterAll(() => {
  mock.module("next/cache", () => nextCache);
  mock.module("next-intl/server", () => intl);
});

let asked = 0;
function site(googleClientId: string | null) {
  asked = 0;
  globalThis.fetch = (async () => {
    asked += 1;
    return Response.json(
      siteBody({
        socialSignIn: {
          providers: googleClientId ? ["google"] : ["github"],
          googleClientId,
        },
      }),
    );
  }) as unknown as typeof fetch;
}

const ID = "123.apps.googleusercontent.com";

test("a guest gets One Tap while Google sign-in is on, in the page's language", async () => {
  cookie = "";
  site(ID);
  const drawn = (await OneTapGate({})) as ReactElement<Record<string, unknown>>;
  expect(drawn.type).toBe(OneTap);
  expect(drawn.props).toEqual({
    clientId: ID,
    locale: "es",
    context: "signin",
  });
});

test("another cookie of the site, such as a sign-in's state, does not hide One Tap", async () => {
  cookie = "sermo.state=abc; __Secure-sermo.state=def; forum_locale=es";
  site(ID);
  expect(await OneTapGate({})).not.toBeNull();
});

test("the sign-up page asks for a sign-up, and the sign-in page names where to go after", async () => {
  cookie = "";
  site(ID);
  const signUp = (await OneTapGate({
    context: "signup",
    next: "/threads/7",
  })) as ReactElement<Record<string, unknown>>;
  expect(signUp.props).toMatchObject({ context: "signup", next: "/threads/7" });
});

test("no One Tap while Google sign-in is off", async () => {
  cookie = "";
  site(null);
  expect(await OneTapGate({})).toBeNull();
});

test("a visitor with a session gets no One Tap, and the site is not even asked", async () => {
  for (const session of [
    "sermo.session_token=abc",
    "__Secure-sermo.session_token=abc",
  ]) {
    cookie = session;
    site(ID);
    expect(await OneTapGate({})).toBeNull();
    expect(asked).toBe(0);
  }
});

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("the forum's layout and the sign-in and sign-up pages draw One Tap; the staff panel never does", () => {
  expect(source("../../app/[locale]/(main)/layout.tsx")).toContain(
    "<OneTapGate",
  );
  expect(source("../../app/[locale]/(auth)/login/page.tsx")).toContain(
    "<OneTapGate",
  );
  expect(source("../../app/[locale]/(auth)/register/page.tsx")).toContain(
    "<OneTapGate",
  );
  expect(source("../../app/[locale]/(staff)/layout.tsx")).not.toContain(
    "one-tap",
  );
  expect(source("../../app/[locale]/layout.tsx")).not.toContain("one-tap");
});
