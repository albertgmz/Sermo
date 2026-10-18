import { expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import { forgetBanner } from "@/lib/sermo/banner";

// The pages asked for here (the home page, the forum list, the register page) need no record, and
// what the proxy knows of the site is faked: its default language and what its cookie policy says.
// The only thing asked of the backend is whether the banner applies to a visitor (a site that
// shows it in Europe only), which `fetch` answers below.
const site = {
  cookiePolicyVersion: 1 as number | null,
  bannerOutsideEu: true,
};
mock.module("@/lib/sermo/default-language", () => ({
  siteDefaultLanguage: async () => "en",
  siteConsentFacts: async () => site,
  siteAnalytics: async () => ({ provider: "none" }),
  forgetDefaultLanguage: () => {},
}));
mock.module("server-only", () => ({}));
mock.module("@/lib/sermo/viewer", () => ({ viewerOf: async () => null }));

// A private copy of the module: another suite may have loaded the proxy against its own mocks.
const source = "../src/proxy.ts?referral";
const { proxy } = (await import(source)) as typeof import("../src/proxy");

const consentTo = (...categories: string[]) =>
  `forum_consent=${encodeURIComponent(
    JSON.stringify({ categories: ["necessary", ...categories], revision: 1 }),
  )}`;
const ACCEPTED = consentTo("referrals");

// A page load, as a browser makes it; `fetch` is what a link followed inside the app makes.
function ask(
  path: string,
  cookie = "",
  headers: Record<string, string> = { "sec-fetch-mode": "navigate" },
) {
  return proxy(
    new NextRequest(`http://localhost${path}`, {
      headers: { ...headers, ...(cookie ? { cookie } : {}) },
    }),
  );
}

const referralCookie = (response: Response | undefined) =>
  response?.headers
    .getSetCookie()
    .find((header) => header.startsWith("forum_ref="));

test("the cookie is set once the visitor accepted referrals: HttpOnly, Lax, thirty days", async () => {
  const response = await ask("/?ref=12", ACCEPTED);
  const cookie = referralCookie(response);
  expect(cookie).toBeDefined();
  expect(cookie).toContain("forum_ref=12");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).toContain("Path=/");
  expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  // The page is still served.
  expect(response?.headers.get("x-middleware-rewrite")).toBe(
    "http://localhost/en?ref=12",
  );
});

test("the cookie is Secure when the site is served over https", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    expect(referralCookie(await ask("/?ref=12", ACCEPTED))).toContain("Secure");
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});

test("without the visitor's consent there is no cookie", async () => {
  for (const cookie of [
    "",
    consentTo(),
    consentTo("analytics", "embeds"),
    // A choice made for another policy version is no choice.
    `forum_consent=${encodeURIComponent(
      JSON.stringify({ categories: ["necessary", "referrals"], revision: 2 }),
    )}`,
    "forum_consent=garbage",
  ]) {
    const response = await ask("/?ref=12", cookie);
    expect(referralCookie(response), cookie).toBeUndefined();
  }
});

test("the first referrer wins: a cookie already holding one is left alone", async () => {
  const response = await ask("/?ref=12", `${ACCEPTED}; forum_ref=7`);
  expect(referralCookie(response)).toBeUndefined();
});

test("a cookie that holds no member id is replaced", async () => {
  const response = await ask("/?ref=12", `${ACCEPTED}; forum_ref=junk`);
  expect(referralCookie(response)).toContain("forum_ref=12");
});

test("a ref that is not a positive whole number is ignored", async () => {
  for (const ref of [
    "",
    "0",
    "-3",
    "1.5",
    "abc",
    "1e2",
    "0x10",
    "%207",
    "007",
  ]) {
    const response = await ask(`/?ref=${ref}`, ACCEPTED);
    expect(referralCookie(response), ref).toBeUndefined();
  }
  // The first of several is the one read.
  expect(referralCookie(await ask("/?ref=x&ref=3", ACCEPTED))).toBeUndefined();
  expect(referralCookie(await ask("/?ref=3&ref=x", ACCEPTED))).toContain(
    "forum_ref=3",
  );
});

test("only a page load sets it, not the fetch behind a link or an action", async () => {
  const link = await ask("/?ref=12", ACCEPTED, { "sec-fetch-mode": "cors" });
  expect(referralCookie(link)).toBeUndefined();
  const action = await proxy(
    new NextRequest("http://localhost/?ref=12", {
      method: "POST",
      headers: { cookie: ACCEPTED, "next-action": "abc" },
    }),
  );
  expect(referralCookie(action)).toBeUndefined();
});

test("any page can carry it, the register page and a redirect included", async () => {
  expect(referralCookie(await ask("/register?ref=5", ACCEPTED))).toContain(
    "forum_ref=5",
  );
  expect(referralCookie(await ask("/forums?ref=5", ACCEPTED))).toContain(
    "forum_ref=5",
  );
  // The language segment is not an address: it redirects, and the redirect keeps the cookie.
  const redirect = await ask("/es/forums?ref=5", ACCEPTED);
  expect(redirect?.status).toBe(308);
  expect(referralCookie(redirect)).toContain("forum_ref=5");
});

test("the API and Next's own files are left alone", async () => {
  expect(await ask("/api/v1/me?ref=5", ACCEPTED)).toBeUndefined();
  expect(await ask("/_next/static/a.js?ref=5", ACCEPTED)).toBeUndefined();
});

test("a cookie the visitor no longer accepts is removed", async () => {
  for (const consent of ["", consentTo(), consentTo("analytics")]) {
    const response = await ask(
      "/",
      `${consent}; forum_ref=7`.replace(/^; /, ""),
    );
    const cookie = referralCookie(response);
    expect(cookie, consent).toContain("forum_ref=;");
    expect(cookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  }
  // While it is accepted it stays, and a request without it sets nothing.
  expect(await ask("/", `${ACCEPTED}; forum_ref=7`)).toSatisfy(
    (response: Response | undefined) => referralCookie(response) === undefined,
  );
  expect(referralCookie(await ask("/", ACCEPTED))).toBeUndefined();
});

test("a member who is signed in is not given the cookie, but a stale one is still removed", async () => {
  for (const session of [
    "sermo.session_token=abc",
    "__Secure-sermo.session_token=abc",
  ]) {
    const response = await ask("/?ref=12", `${ACCEPTED}; ${session}`);
    expect(referralCookie(response), session).toBeUndefined();
  }
  const stale = await ask("/", `sermo.session_token=abc; forum_ref=7`);
  expect(referralCookie(stale)).toContain("forum_ref=;");
});

test("a page reached through ?ref= gets no canonical header of its own", async () => {
  const response = await ask("/forums?ref=9", ACCEPTED);
  expect(response?.headers.get("link")).toBeNull();
});

const choice = (revision: number, ...categories: string[]) =>
  `forum_consent=${encodeURIComponent(
    JSON.stringify({ categories: ["necessary", ...categories], revision }),
  )}`;

test("the policy version is the site's: a choice answers it, an older one is no choice", async () => {
  site.cookiePolicyVersion = 3;
  try {
    expect(
      referralCookie(await ask("/?ref=12", choice(3, "referrals"))),
    ).toContain("forum_ref=12");
    // Accepted under the version before the last "ask everyone again".
    expect(
      referralCookie(await ask("/?ref=12", choice(1, "referrals"))),
    ).toBeUndefined();
    // And a cookie held under that older choice is removed.
    expect(
      referralCookie(await ask("/", `${choice(2, "referrals")}; forum_ref=7`)),
    ).toContain("forum_ref=;");
  } finally {
    site.cookiePolicyVersion = 1;
  }
});

test("while the site has not been read nothing is set and nothing is removed", async () => {
  site.cookiePolicyVersion = null;
  try {
    expect(referralCookie(await ask("/?ref=12", ACCEPTED))).toBeUndefined();
    expect(
      referralCookie(await ask("/", `${ACCEPTED}; forum_ref=7`)),
    ).toBeUndefined();
    expect(referralCookie(await ask("/", "forum_ref=7"))).toBeUndefined();
  } finally {
    site.cookiePolicyVersion = 1;
  }
});

// A site whose banner is for Europe only: a visitor it does not ask counts as accepting.
async function withBannerFor(
  shown: boolean | "fails",
  run: (asked: () => number) => Promise<void>,
) {
  forgetBanner();
  const realFetch = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = (async () => {
    asked += 1;
    if (shown === "fails") throw new TypeError("connection refused");
    return Response.json({ show: shown });
  }) as unknown as typeof fetch;
  site.bannerOutsideEu = false;
  try {
    await run(() => asked);
  } finally {
    site.bannerOutsideEu = true;
    globalThis.fetch = realFetch;
  }
}

test("a visitor the banner is not shown to has the cookie set, a visitor who is asked has not", async () => {
  await withBannerFor(false, async (asked) => {
    expect(referralCookie(await ask("/?ref=12"))).toContain("forum_ref=12");
    expect(asked()).toBe(1);
  });
  await withBannerFor(true, async () => {
    expect(referralCookie(await ask("/?ref=12"))).toBeUndefined();
  });
});

test("a choice made outside the banner's reach still counts, and the backend is not asked", async () => {
  await withBannerFor(false, async (asked) => {
    expect(referralCookie(await ask("/?ref=12", consentTo()))).toBeUndefined();
    expect(referralCookie(await ask("/?ref=12", ACCEPTED))).toContain(
      "forum_ref=12",
    );
    expect(asked()).toBe(0);
  });
});

test("when the backend cannot say whether the banner applies, the visitor is asked: no cookie", async () => {
  await withBannerFor("fails", async () => {
    expect(referralCookie(await ask("/?ref=12"))).toBeUndefined();
  });
});

test("a request without a referral does not ask the backend anything", async () => {
  await withBannerFor(false, async (asked) => {
    await ask("/forums");
    await ask("/");
    expect(asked()).toBe(0);
  });
});

test("a held cookie of a visitor who is not asked costs one question a minute, not one a request", async () => {
  await withBannerFor(false, async (asked) => {
    for (let page = 0; page < 5; page += 1) {
      const response = await ask("/forums", "forum_ref=7");
      expect(referralCookie(response)).toBeUndefined();
    }
    expect(asked()).toBe(1);
  });
});

test("when the backend cannot say, a cookie already held stays, and nothing new is set", async () => {
  await withBannerFor("fails", async () => {
    expect(referralCookie(await ask("/", "forum_ref=7"))).toBeUndefined();
    expect(referralCookie(await ask("/?ref=12"))).toBeUndefined();
  });
});

test("a refusal made under an earlier policy version stays a refusal for a visitor the banner is not shown to", async () => {
  site.cookiePolicyVersion = 2;
  try {
    await withBannerFor(false, async (asked) => {
      // Refused everything at version 1; the site is now at 2 and the visitor is outside Europe.
      expect(referralCookie(await ask("/?ref=12", choice(1)))).toBeUndefined();
      // The referral cookie held from before goes, as for any visitor who has not accepted it.
      const cleared = referralCookie(
        await ask("/forums", `${choice(1)}; forum_ref=7`),
      );
      expect(cleared).toContain("forum_ref=;");
      // Asked again, not silently treated as accepting, and the backend is not even asked.
      expect(asked()).toBe(0);
    });
  } finally {
    site.cookiePolicyVersion = 1;
  }
});

const GPC = { "sec-fetch-mode": "navigate", "sec-gpc": "1" };
// A choice the banner recorded while the browser sent Global Privacy Control.
const acceptedUnderGpc = `forum_consent=${encodeURIComponent(
  JSON.stringify({
    categories: ["necessary", "referrals"],
    revision: 1,
    data: { gpc: true },
  }),
)}`;

test("under Sec-GPC: 1 a visitor the banner is not shown to gets no cookie, and the backend is not asked", async () => {
  await withBannerFor(false, async (asked) => {
    expect(referralCookie(await ask("/?ref=12", "", GPC))).toBeUndefined();
    expect(asked()).toBe(0);
    // Without the signal the same visitor counts as accepting.
    expect(referralCookie(await ask("/?ref=12"))).toContain("forum_ref=12");
  });
});

test("under Sec-GPC: 1 an acceptance made before the signal sets nothing and removes a held cookie; one made after it stands", async () => {
  expect(referralCookie(await ask("/?ref=12", ACCEPTED, GPC))).toBeUndefined();
  const held = referralCookie(await ask("/", `${ACCEPTED}; forum_ref=7`, GPC));
  expect(held).toContain("forum_ref=;");
  expect(
    referralCookie(await ask("/?ref=12", acceptedUnderGpc, GPC)),
  ).toContain("forum_ref=12");
});

test("the Data saver cookie of an old installation is rewritten Secure when the site is served over https", async () => {
  const before = process.env.SERMO_PUBLIC_URL;
  process.env.SERMO_PUBLIC_URL = "https://forum.example.test";
  try {
    const migrated = (await ask("/", "forum_lite=1"))?.headers
      .getSetCookie()
      .find((header) => header.startsWith("forum_lite="));
    expect(migrated).toContain("Secure");
    expect(migrated).toContain("SameSite=lax");
    expect(migrated).not.toContain("HttpOnly");
  } finally {
    if (before === undefined) delete process.env.SERMO_PUBLIC_URL;
    else process.env.SERMO_PUBLIC_URL = before;
  }
});

// A guest's public page may be kept by the browser (`private, no-cache`), unless its answer sets or
// removes the referral cookie: then it is the visitor's own and Next's `no-store` stays.
test("a public page that sets or removes the referral cookie is not kept by the browser", async () => {
  const cacheOf = (response: Response | undefined) =>
    response?.headers.get("cache-control") ?? null;
  const given = await ask("/?ref=12", ACCEPTED);
  expect(referralCookie(given)).toContain("forum_ref=12");
  expect(cacheOf(given)).toBeNull();
  const removed = await ask("/forums", "forum_ref=7");
  expect(referralCookie(removed)).toContain("forum_ref=;");
  expect(cacheOf(removed)).toBeNull();
  // No consent, or Global Privacy Control: no cookie, so the page may be kept.
  const guests: Record<string, string>[] = [
    { "sec-fetch-mode": "navigate" },
    { "sec-fetch-mode": "navigate", "sec-gpc": "1" },
  ];
  for (const headers of guests) {
    const kept = await ask("/?ref=12", "", headers);
    expect(referralCookie(kept)).toBeUndefined();
    expect(cacheOf(kept)).toBe("private, no-cache");
  }
});
