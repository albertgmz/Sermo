import { afterAll, afterEach, mock, spyOn, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import english from "../../../messages/en/layout.json";
import spanish from "../../../messages/es/layout.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const incoming = new Headers({
  cookie: "theme=dark; sermo.session_token=abc",
  "user-agent": "agent/1",
  "x-forwarded-for": "203.0.113.9, 198.51.100.4",
});
mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
let language: "en" | "es" = "en";
mock.module("next-intl/server", () => ({
  getLocale: async () => language,
  getTranslations: async () => (key: string) =>
    (language === "es" ? spanish : english).navigation[
      key as keyof typeof english.navigation
    ],
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));

const { getNavigation } = await import("./navigation");

const plain = { icon: null, iconPosition: "before" as const };
const home = {
  id: 1,
  title: "Start",
  target: "/",
  builtin: "header.home",
  ...plain,
};
const answer = {
  header: [{ ...home, children: [] }],
  mobile: [],
  account: [],
  footer: [
    {
      id: 2,
      title: "Community",
      target: null,
      builtin: "footer.community",
      ...plain,
      children: [
        {
          id: 3,
          title: "Boards",
          target: "/forums",
          builtin: "footer.community.forums",
          ...plain,
        },
      ],
    },
  ],
};

const me = {
  user: {
    id: 1,
    username: "ann",
    email: "ann@example.test",
    groupId: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    displayGroup: null,
    language: null,
    keyboardShortcuts: true,
    homeTab: null,
    feedView: "cards",
    openHomeTab: "latest",
    pendingAcceptance: [],
    awaitingApproval: false,
    sessionId: 1,
  },
  permissions: {
    isAdmin: false,
    isModerator: false,
    canViewProfiles: true,
    canPostProfile: true,
    canStartConversations: true,
    canReact: true,
  },
  resolvedPermissions: {},
  staff: {
    panel: false,
    moderatesEverywhere: false,
    moderatedNodeIds: [],
    moderatedNodesTruncated: false,
  },
};

test("the answer is passed through and asked with the visitor's cookies", async () => {
  const seen: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers) });
    // The session is settled on auth.me first; this one is live.
    return Response.json(url.endsWith("/api/v1/me") ? me : answer);
  }) as unknown as typeof fetch;
  assert.deepEqual(await getNavigation(), answer);
  const asked = seen.find(({ url }) => url.endsWith("/api/v1/navigation"));
  assert.ok(asked);
  assert.equal(asked.headers.get("cookie"), "sermo.session_token=abc");
  assert.equal(asked.headers.get("x-forwarded-for"), "198.51.100.4");
});

test("a session the backend refuses asks for the navigation as a guest", async () => {
  const cookies: (string | null)[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const cookie = new Headers(init.headers).get("cookie");
    if (url.endsWith("/api/v1/me"))
      return Response.json(
        { error: { code: "unauthenticated", message: "dead" } },
        { status: 401 },
      );
    cookies.push(cookie);
    return Response.json(answer);
  }) as unknown as typeof fetch;
  assert.deepEqual(await getNavigation(), answer);
  assert.deepEqual(cookies, [null]);
});

test("an unreachable backend gives four empty lists and is logged outside the build only", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  const phase = process.env.NEXT_PHASE;
  const empty = { header: [], mobile: [], account: [], footer: [] };
  // The read of the session logs its own failure; this is about the navigation's.
  const navigationLogs = () =>
    logged.mock.calls.filter(([message]) =>
      String(message).startsWith("The navigation"),
    ).length;
  try {
    process.env.NEXT_PHASE = "phase-production-server";
    assert.deepEqual(await getNavigation(), empty);
    assert.equal(navigationLogs(), 1);

    process.env.NEXT_PHASE = "phase-production-build";
    assert.deepEqual(await getNavigation(), empty);
    assert.equal(navigationLogs(), 1);
  } finally {
    if (phase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = phase;
    logged.mockRestore();
  }
});

test("an answer that breaks the contract also gives the empty lists", async () => {
  globalThis.fetch = (async () =>
    Response.json({ header: "nope" })) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.deepEqual(await getNavigation(), {
      header: [],
      mobile: [],
      account: [],
      footer: [],
    });
  } finally {
    logged.mockRestore();
  }
});

const entry = (id: number, title: string, builtin: string | null) => ({
  id,
  title,
  target: "/x",
  builtin,
  ...plain,
  children: [],
});

test("a built-in entry that still has its seeded title is drawn in the visitor's language, a renamed one is not", async () => {
  language = "es";
  try {
    globalThis.fetch = (async (url: string) =>
      Response.json(
        url.endsWith("/api/v1/me")
          ? me
          : {
              header: [
                entry(1, "Forums", "header.home"),
                entry(2, "Start", "header.novedades"),
                entry(3, "Forums", null),
              ],
              mobile: [entry(4, "Log in", "mobile.login")],
              account: [entry(5, "Upgrade", "account.upgrade")],
              footer: [
                {
                  ...entry(6, "Legal", "footer.legal"),
                  children: [entry(7, "Legal notice", "footer.legal.notice")],
                },
              ],
            },
      )) as unknown as typeof fetch;
    const { header, mobile, account, footer } = await getNavigation();
    assert.deepEqual(
      header.map((item) => item.title),
      ["Foros", "Start", "Forums"],
    );
    assert.equal(mobile[0]?.title, "Iniciar sesión");
    assert.equal(account[0]?.title, "Mejorar cuenta");
    assert.equal(footer[0]?.title, "Legal");
    assert.equal(footer[0]?.children[0]?.title, "Aviso legal");
  } finally {
    language = "en";
  }
});

test("the English titles are the ones the migrations seed", () => {
  const dir = new URL("../../../../../packages/core/drizzle/", import.meta.url);
  const sql = readFileSync(new URL("0021_site_chrome.sql", dir), "utf8");
  const seeded = new Map<string, string>();
  const rows = [
    /\('(?:header|mobile|account|footer)', NULL, '([^']+)', (?:'[^']*'|NULL), \d+, 1, '\w+', '([a-z.]+)'/g,
    /\('footer\.[a-z]+', '([^']+)', '[^']+', \d+, '([a-z.]+)'\)/g,
  ];
  for (const row of rows)
    for (const [, title, builtin] of sql.matchAll(row))
      seeded.set(builtin as string, title as string);
  // Migration 0030 turns the header's Upgrade entry into the account menu's and drops the footer's.
  seeded.set("account.upgrade", seeded.get("header.upgrade") as string);
  seeded.delete("header.upgrade");
  seeded.delete("footer.useful.upgrade");
  // Migration 0058 drops the mobile bar's Forums entry: Home leads to the forums list there.
  seeded.delete("mobile.forums");
  // Migration 0065 makes Home the forum list, so it is called Forums, sends the header's Forums
  // entry to What's new and puts What's new in the phone bar's Profile place.
  seeded.set("header.home", "Forums");
  seeded.delete("header.forums");
  seeded.set("header.novedades", "What's new");
  seeded.delete("mobile.profile");
  seeded.set("mobile.novedades", "What's new");
  const camel = (key: string) =>
    key
      .split(".")
      .map((part, index) =>
        index === 0 ? part : (part[0] as string).toUpperCase() + part.slice(1),
      )
      .join("");
  assert.deepEqual(
    Object.fromEntries([...seeded].map(([key, title]) => [camel(key), title])),
    english.navigation,
  );
  assert.deepEqual(
    Object.keys(spanish.navigation),
    Object.keys(english.navigation),
  );
});
