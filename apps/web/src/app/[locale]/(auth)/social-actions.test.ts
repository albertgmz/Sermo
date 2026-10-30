import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { HYDRATED_FIELD } from "@/app/[locale]/(auth)/native-form";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const written: Record<string, unknown>[] = [];

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => written.push(cookie),
    get: () => undefined,
    has: () => false,
    delete: () => {},
    toString: () => "",
  }),
}));

const { chooseUsername } = await import("./actions");
const { signInWith } = await import("./social-actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  written.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

type Sent = { url: string; body: Record<string, unknown> };

// The backend: `answer` for the call under test, a member who still needs a username for auth.me
// (or the one `me` gives), and the site with `registration`.
function backend(
  answer: () => Response,
  options: { me?: () => unknown; registrationOpen?: boolean } = {},
) {
  const sent: Sent[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (url.endsWith("/api/v1/site"))
      return Response.json(
        siteBody({
          registration: {
            open: options.registrationOpen ?? true,
            approval: false,
            minimumAge: 13,
            fields: [],
          },
        }),
      );
    if (url.endsWith("/api/v1/me"))
      return Response.json(options.me?.() ?? needing());
    sent.push({ url, body });
    return answer();
  }) as unknown as typeof fetch;
  return sent;
}

const needing = () => {
  const viewer = viewerBody(true);
  return {
    ...viewer,
    user: { ...viewer.user, username: "Juan", groupId: 5, needsUsername: true },
  };
};

function form(fields: Record<string, string>, hydrated = true) {
  const data = new FormData();
  data.set(HYDRATED_FIELD, hydrated ? "1" : "");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// Where a redirect thrown by `run` goes, or null when it returned.
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

test("a provider's button starts its sign-in and sends the browser to the provider's page", async () => {
  const sent = backend(() =>
    Response.json(
      {
        url: "https://accounts.google.com/o/oauth2/v2/auth?state=s",
        redirect: false,
      },
      {
        headers: {
          "set-cookie": "sermo.state=s1; Path=/; HttpOnly; Max-Age=300",
        },
      },
    ),
  );
  const target = await redirectOf(() =>
    signInWith(
      form({ provider: "google", from: "/login", next: "/threads/7" }),
    ),
  );
  expect(target).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=s");
  expect(sent[0].url).toEndWith("/api/auth/sign-in/social");
  const { body } = sent[0];
  expect(body.provider).toBe("google");
  expect(String(body.callbackURL)).toEndWith("/threads/7");
  expect(String(body.newUserCallbackURL)).toEndWith(
    "/choose-username?next=%2Fthreads%2F7",
  );
  expect(String(body.errorCallbackURL)).toEndWith(
    "/login?next=%2Fthreads%2F7&via=google",
  );
  // The state the provider's return is checked against reaches the browser.
  expect(written.map((cookie) => cookie.name)).toContain("sermo.state");
});

test("a sign-in from the sign-up page comes back there when refused, and an evil next is dropped", async () => {
  const sent = backend(() =>
    Response.json({ url: "https://github.com/login/oauth/authorize?x=1" }),
  );
  await redirectOf(() =>
    signInWith(
      form({ provider: "github", from: "/register", next: "//evil.example" }),
    ),
  );
  const { body } = sent[0];
  expect(String(body.callbackURL)).toMatch(/^https?:\/\/[^/]+\/$/);
  expect(String(body.errorCallbackURL)).toEndWith("/register?via=github");
  expect(String(body.newUserCallbackURL)).toEndWith("/choose-username");
});

test("a sign-in the backend cannot start comes back with its code; an unknown provider starts nothing", async () => {
  backend(() => Response.json({ code: "RATE_LIMITED" }, { status: 429 }));
  expect(
    await redirectOf(() =>
      signInWith(form({ provider: "twitter", from: "/login" })),
    ),
  ).toBe("/login?via=twitter&error=RATE_LIMITED");
  const sent = backend(() => Response.json({}));
  expect(
    await redirectOf(() =>
      signInWith(form({ provider: "facebook", from: "/login" })),
    ),
  ).toBe("/login");
  expect(sent).toHaveLength(0);
});

const choice = (fields: Record<string, string> = {}, hydrated = true) =>
  form({ username: "Juanito", terms: "on", ...fields }, hydrated);
const empty = { error: "", username: "" };

test("a chosen username goes to the backend with the terms, then on to a same-site next", async () => {
  const sent = backend(() => Response.json({ username: "Juanito" }));
  expect(
    await redirectOf(() =>
      chooseUsername(empty, choice({ next: "/threads/7?page=2" })),
    ),
  ).toBe("/threads/7?page=2");
  expect(sent[0].url).toEndWith("/api/v1/me/username");
  expect(sent[0].body).toEqual({ username: "Juanito", acceptTerms: true });
});

test("an evil next goes to the home page instead", async () => {
  for (const next of ["//evil.example", "https://evil.example/", "/\\evil"]) {
    backend(() => Response.json({ username: "Juanito" }));
    expect(
      await redirectOf(() => chooseUsername(empty, choice({ next }))),
    ).toBe("/");
  }
});

test("the profile fields the site asks go with the choice", async () => {
  const sent = backend(() => Response.json({ username: "Juanito" }));
  await redirectOf(() =>
    chooseUsername(
      empty,
      choice({ location: "Holguín", birthday: "2000-05-04" }),
    ),
  );
  expect(sent[0].body.profile).toEqual({
    location: "Holguín",
    birthday: { year: 2000, month: 5, day: 4 },
  });
});

test("without the terms ticked nothing is sent", async () => {
  const sent = backend(() => Response.json({ username: "Juanito" }));
  const state = await chooseUsername(empty, form({ username: "Juanito" }));
  expect(state.error).toBe(translator("auth.actions.errors")("termsRequired"));
  expect(state.username).toBe("Juanito");
  expect(sent).toHaveLength(0);
});

const refusal =
  (code: string, status: number, message = "Refused.") =>
  () =>
    Response.json({ error: { code, message } }, { status });

test("each refusal of the choice is told in the visitor's words", async () => {
  const t = translator("auth.actions.errors");
  const cases: [() => Response, string, Record<string, string>?][] = [
    [refusal("conflict", 409, "That username is taken."), t("usernameTaken")],
    [refusal("validation", 400), t("invalidUsername")],
    [refusal("validation", 400), t("invalidField"), { location: "x" }],
    [refusal("forbidden", 403), t("underAge")],
    [refusal("rate_limited", 429), t("rateLimited")],
  ];
  for (const [answer, words, fields] of cases) {
    backend(answer);
    const state = await chooseUsername(empty, choice(fields));
    expect(state.error).toBe(words);
    expect(state.username).toBe("Juanito");
  }
  backend(refusal("forbidden", 403), { registrationOpen: false });
  expect((await chooseUsername(empty, choice())).error).toBe(
    t("registrationClosed"),
  );
});

test("a choice already made goes on to next instead of a refusal", async () => {
  backend(refusal("conflict", 409), { me: () => viewerBody(true) });
  expect(
    await redirectOf(() =>
      chooseUsername(empty, choice({ next: "/members/1" })),
    ),
  ).toBe("/members/1");
});

test("a form sent without the page's script comes back to the screen naming the refusal", async () => {
  backend(refusal("conflict", 409));
  expect(
    await redirectOf(() =>
      chooseUsername(empty, choice({ next: "/threads/7" }, false)),
    ),
  ).toBe("/choose-username?next=%2Fthreads%2F7&refused=usernameTaken");
});
