import { afterEach, expect, test } from "bun:test";
import { insertNode, insertUser } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { accounts, closeAll, PASSWORD } from "../admin/fixtures.test";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { getAuth, promoteVerifiedMember, resolveActor } from "./index";
import { configureSocialSignIn, provisionalUsername } from "./social";

const ORIGIN = "http://localhost:3000";
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  closeAll();
});

const CREDENTIALS = {
  google: { clientId: "google-client.apps.googleusercontent.com", clientSecret: "google-secret-1" },
  github: { clientId: "github-client", clientSecret: "github-secret-2" },
  twitter: { clientId: "twitter-client", clientSecret: "twitter-secret-3" },
};

type Profile = { id: string; name: string; email: string | null; verified?: boolean };

const base64url = (value: string | Uint8Array) => Buffer.from(value).toString("base64url");
/** An id token as the provider's token endpoint returns it (the code flow only decodes it). */
const idToken = (claims: object) =>
  `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claims))}.c2ln`;

/**
 * Stands in for the providers' token and user endpoints, the one boundary these tests replace.
 * Each provider answers with the profile given for it.
 */
function fakeProviders(profiles: Partial<Record<"google" | "github" | "twitter", Profile>>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    const json = (body: unknown) => Response.json(body);
    const { google, github, twitter } = profiles;
    if (url.href.startsWith("https://oauth2.googleapis.com/token") && google)
      return json({
        access_token: "google-access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken({
          sub: google.id,
          email: google.email,
          email_verified: google.verified ?? true,
          name: google.name,
        }),
      });
    if (url.href.startsWith("https://github.com/login/oauth/access_token") && github)
      return json({ access_token: "github-access", token_type: "bearer", scope: "user:email" });
    if (url.href === "https://api.github.com/user" && github)
      return json({ id: Number(github.id), login: github.name, name: github.name, email: null });
    if (url.href === "https://api.github.com/user/emails" && github)
      return json(
        github.email
          ? [{ email: github.email, primary: true, verified: github.verified ?? true }]
          : [],
      );
    if (url.href.startsWith("https://api.x.com/2/oauth2/token") && twitter)
      return json({ access_token: "x-access", token_type: "bearer", expires_in: 7200 });
    if (url.href.startsWith("https://api.x.com/2/users/me") && twitter)
      return json({
        data: {
          id: twitter.id,
          name: twitter.name,
          username: twitter.name,
          ...(twitter.email && url.search.includes("confirmed_email")
            ? { confirmed_email: twitter.email }
            : {}),
        },
      });
    throw new Error(`Unexpected request to ${url.href}`);
  }) as typeof fetch;
}

let visitor = 0;
const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((entry) => entry.slice(0, entry.indexOf(";")))
    .filter((pair) => !pair.endsWith("="));

async function world(providers: Partial<typeof CREDENTIALS> = CREDENTIALS) {
  const w = await accounts();
  configureSocialSignIn(w.ctx, providers);
  const founder = await w.register("Founder", 4);
  const node = insertNode(w.ctx, { type: "forum" });
  invalidate(w.ctx, "node_tree");
  const auth = (path: string, init: RequestInit = {}) =>
    getAuth(w.ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        ...init,
        headers: {
          origin: ORIGIN,
          "x-sermo-client-ip": `203.0.113.${++visitor}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      }),
    );
  /**
   * A visitor who presses "Continue with <provider>": the sign-in request, then the provider
   * sends the browser back to the callback with a code. Returns where the browser goes next and
   * the session cookie it holds. `stale` is a cookie the browser still sends with both requests.
   */
  const signInWith = async (provider: "google" | "github" | "twitter", stale?: string) => {
    const start = await auth("/sign-in/social", {
      method: "POST",
      ...(stale ? { headers: { cookie: stale } } : {}),
      body: JSON.stringify({
        provider,
        callbackURL: `${ORIGIN}/`,
        errorCallbackURL: `${ORIGIN}/login`,
        disableRedirect: true,
      }),
    });
    if (start.status !== 200) return { status: start.status, location: null, cookie: "" };
    const { url } = (await start.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const back = await auth(
      `/callback/${provider}?code=code-1&state=${encodeURIComponent(state)}`,
      {
        headers: { cookie: [...cookiesOf(start), ...(stale ? [stale] : [])].join("; ") },
      },
    );
    return {
      status: back.status,
      location: new URL(back.headers.get("location")!, ORIGIN),
      cookie: cookiesOf(back).join("; "),
    };
  };
  const actorOf = async (cookie: string) =>
    (await resolveActor(w.ctx, new Headers({ cookie }))).actor;
  const me = async (cookie: string) => (await w.run("auth.me", await actorOf(cookie))).user;
  const post = async (cookie: string) =>
    w.run("threads.create", await actorOf(cookie), {
      nodeId: node.id,
      title: "Hello",
      body: "My first post",
    });
  const count = (sql: string) => w.ctx.sqlite.prepare<{ n: number }, []>(sql).get()!.n;
  return { ...w, founder, auth, signInWith, actorOf, me, post, count };
}

test("with no provider configured nothing is offered and the routes do not exist", async () => {
  const w = await world({});
  const site = await w.run("site.get", GUEST);
  expect(site.socialSignIn).toEqual({ providers: [], googleClientId: null });
  expect((await w.signInWith("google")).status).toBe(404);
  const tap = await w.auth("/one-tap/callback", {
    method: "POST",
    body: JSON.stringify({ idToken: "x" }),
  });
  expect(tap.status).toBe(404);
});

test("site.get names the configured providers and the public Google client id, never a secret", async () => {
  const w = await world({ google: CREDENTIALS.google, twitter: CREDENTIALS.twitter });
  const site = await w.run("site.get", GUEST);
  expect(site.socialSignIn).toEqual({
    providers: ["google", "twitter"],
    googleClientId: CREDENTIALS.google.clientId,
  });
  const text = JSON.stringify(site);
  for (const { clientSecret } of Object.values(CREDENTIALS))
    expect(text).not.toContain(clientSecret);
  // A provider that is not configured has no route.
  expect((await w.signInWith("github")).status).toBe(404);
});

test("a new member from Google chooses a username once, accepts the terms, and can then post", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-1", name: "Juan Pérez", email: "juan@example.test" } });
  const before = w.count("SELECT count(*) AS n FROM users");
  const signedIn = await w.signInWith("google");
  expect(signedIn.status).toBe(302);
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect(w.count("SELECT count(*) AS n FROM users")).toBe(before + 1);

  const fresh = await w.me(signedIn.cookie);
  expect(fresh).toMatchObject({ email: "juan@example.test", needsUsername: true, groupId: 5 });
  // The provisional name is the first name the provider gives, made valid by the registration
  // rule: not the full real name.
  expect(fresh!.username).toBe("Juan");
  await expect(w.post(signedIn.cookie)).rejects.toBeInstanceOf(ForbiddenError);

  const actor = await w.actorOf(signedIn.cookie);
  const chosen = await w.run("auth.chooseUsername", actor, {
    username: "Juanito",
    acceptTerms: true,
  });
  expect(chosen).toEqual({ username: "Juanito" });
  const after = await w.me(signedIn.cookie);
  expect(after).toMatchObject({ username: "Juanito", needsUsername: false, groupId: 2 });
  expect(
    w.ctx.sqlite
      .prepare<{ username: string }, [number]>("SELECT username FROM auth_user WHERE id = ?1")
      .get(after!.id)!.username,
  ).toBe("juanito");
  expect((await w.post(signedIn.cookie)).thread.id).toBeGreaterThan(0);

  // Once only.
  await expect(
    w.run("auth.chooseUsername", actor, { username: "Juanote", acceptTerms: true }),
  ).rejects.toBeInstanceOf(ConflictError);
  expect((await w.me(signedIn.cookie))!.username).toBe("Juanito");

  // The next sign-in with Google is the same account.
  const again = await w.signInWith("google");
  expect((await w.me(again.cookie))!.id).toBe(after!.id);
  expect(w.count("SELECT count(*) AS n FROM users")).toBe(before + 1);
});

test("choosing a username records the terms and rules the site publishes", async () => {
  const w = await world();
  for (const slug of ["terms", "rules"])
    await w.run("pages.save", w.founder.actor, {
      slug,
      title: slug,
      body: "Read me.",
      isPublished: true,
    });
  fakeProviders({ google: { id: "g-2", name: "Ana", email: "ana@example.test" } });
  const { cookie } = await w.signInWith("google");
  expect((await w.me(cookie))!.pendingAcceptance).toHaveLength(2);
  await w.run("auth.chooseUsername", await w.actorOf(cookie), {
    username: "Ana Maria",
    acceptTerms: true,
  });
  expect((await w.me(cookie))!.pendingAcceptance).toEqual([]);
});

test("the chosen username meets the registration rule and must be free", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-3", name: "Lola", email: "lola@example.test" } });
  const { cookie } = await w.signInWith("google");
  const actor = await w.actorOf(cookie);
  const choose = (username: string) =>
    w.run("auth.chooseUsername", actor, { username, acceptTerms: true });
  await expect(choose("ab")).rejects.toBeInstanceOf(ValidationError);
  await expect(choose("x".repeat(33))).rejects.toBeInstanceOf(ValidationError);
  await expect(choose("bad!name")).rejects.toBeInstanceOf(ValidationError);
  await expect(choose(" Lola")).rejects.toBeInstanceOf(ValidationError);
  await expect(choose("Deleted member 9")).rejects.toBeInstanceOf(ConflictError);
  await expect(choose("founder")).rejects.toBeInstanceOf(ConflictError);
  // The terms must be accepted.
  await expect(
    w.run("auth.chooseUsername", actor, { username: "Lolita", acceptTerms: false }),
  ).rejects.toBeInstanceOf(ValidationError);
  // Nothing was chosen by the refusals.
  expect(await w.me(cookie)).toMatchObject({ needsUsername: true, groupId: 5 });
  await choose("Lolita");
  expect(await w.me(cookie)).toMatchObject({ username: "Lolita", needsUsername: false });
});

test("the minimum age and required fields of the sign-up form apply to the chosen username", async () => {
  const w = await world();
  storeSiteSettings(w.ctx, { ...readSiteSettings(w.ctx), minimumAge: 18 });
  fakeProviders({ google: { id: "g-4", name: "Nene", email: "nene@example.test" } });
  const { cookie } = await w.signInWith("google");
  const actor = await w.actorOf(cookie);
  const year = new Date(w.ctx.now()).getUTCFullYear();
  await expect(
    w.run("auth.chooseUsername", actor, { username: "Nene", acceptTerms: true }),
  ).rejects.toBeInstanceOf(ValidationError);
  await expect(
    w.run("auth.chooseUsername", actor, {
      username: "Nene",
      acceptTerms: true,
      profile: { birthday: { year: year - 10, month: 1, day: 1 } },
    }),
  ).rejects.toBeInstanceOf(ForbiddenError);
  await w.run("auth.chooseUsername", actor, {
    username: "Nene",
    acceptTerms: true,
    profile: { birthday: { year: year - 30, month: 1, day: 1 } },
  });
  expect(await w.me(cookie)).toMatchObject({ username: "Nene", needsUsername: false });
});

test("only a member who still needs a username may choose one", async () => {
  const w = await world();
  await expect(
    w.run("auth.chooseUsername", GUEST, { username: "Someone", acceptTerms: true }),
  ).rejects.toBeInstanceOf(UnauthenticatedError);
  await expect(
    w.run("auth.chooseUsername", w.founder.actor, { username: "Founder Two", acceptTerms: true }),
  ).rejects.toBeInstanceOf(ConflictError);
});

test("a confirmed address does not make a member who needs a username a full member", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-5", name: "Pepe", email: "pepe@example.test" } });
  const { cookie } = await w.signInWith("google");
  const { id } = (await w.me(cookie))!;
  expect(promoteVerifiedMember(w.ctx, id)).toBe(false);
  expect((await w.me(cookie))!.groupId).toBe(5);
});

test("an existing member's verified address links Google to the account, and the imported password still signs in", async () => {
  const w = await world();
  const member = await w.register("Carmen");
  const password = "Imported-secret-1";
  const bcrypt = (await Bun.password.hash(password, { algorithm: "bcrypt", cost: 4 })).replace(
    /^\$2[ab]\$/,
    "$2y$",
  );
  w.ctx.sqlite
    .prepare(
      "UPDATE auth_account SET password = ?1 WHERE user_id = ?2 AND provider_id = 'credential'",
    )
    .run(bcrypt, member.id);
  w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
  fakeProviders({ google: { id: "g-6", name: "Carmen G", email: "Carmen@Example.test" } });
  const users = w.count("SELECT count(*) AS n FROM auth_user");

  const signedIn = await w.signInWith("google");
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect(await w.me(signedIn.cookie)).toMatchObject({
    id: member.id,
    username: "Carmen",
    needsUsername: false,
    groupId: 2,
  });
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
  expect(
    w.ctx.sqlite
      .prepare<{ provider_id: string }, [number]>(
        "SELECT provider_id FROM auth_account WHERE user_id = ?1 ORDER BY provider_id",
      )
      .all(member.id)
      .map((row) => row.provider_id),
  ).toEqual(["credential", "google"]);
  const byPassword = await w.auth("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: "carmen@example.test", password }),
  });
  expect(byPassword.status).toBe(200);
});

test("an existing account whose own address is not verified is linked when the provider verified the address", async () => {
  const w = await world();
  const member = await w.register("Rosa");
  fakeProviders({ github: { id: "77", name: "rosa", email: "rosa@example.test" } });
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  const signedIn = await w.signInWith("github");
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect((await w.me(signedIn.cookie))!.id).toBe(member.id);
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
});

/** Signs in with the member's password: the session cookie, or "" when refused. */
async function passwordCookie(w: Awaited<ReturnType<typeof world>>, email: string) {
  const answer = await w.auth("/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return answer.status === 200 ? cookiesOf(answer).join("; ") : "";
}

const providersOf = (w: Awaited<ReturnType<typeof world>>, userId: number) =>
  w.ctx.sqlite
    .prepare<{ provider_id: string }, [number]>(
      "SELECT provider_id FROM auth_account WHERE user_id = ?1 ORDER BY provider_id",
    )
    .all(userId)
    .map((row) => row.provider_id);

const emailVerified = (w: Awaited<ReturnType<typeof world>>, userId: number) =>
  w.ctx.sqlite
    .prepare<{ email_verified: number }, [number]>(
      "SELECT email_verified FROM auth_user WHERE id = ?1",
    )
    .get(userId)!.email_verified;

test("Google on an imported account with an unconfirmed address links it, confirms it, and ends its password, keys and other sessions", async () => {
  const w = await world();
  const member = await w.register("Nora", 5);
  w.ctx.sqlite.prepare("UPDATE users SET imported = 1 WHERE id = ?1").run(member.id);
  const other = await passwordCookie(w, "nora@example.test");
  expect(other).toContain("session_token");
  await getAuth(w.ctx).api.createApiKey({ body: { userId: String(member.id), name: "k" } });
  fakeProviders({ google: { id: "g-40", name: "Nora", email: "nora@example.test" } });

  const signedIn = await w.signInWith("google");
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect(await w.me(signedIn.cookie)).toMatchObject({ id: member.id, groupId: 2 });
  expect(emailVerified(w, member.id)).toBe(1);
  expect(providersOf(w, member.id)).toEqual(["google"]);
  expect(await passwordCookie(w, "nora@example.test")).toBe("");
  // The session made before (held in a cached cookie too) is refused; the new one works.
  await expect(w.actorOf(other)).rejects.toBeInstanceOf(UnauthenticatedError);
  expect(w.sessions(member.id)).toBe(1);
  expect(w.count(`SELECT count(*) AS n FROM auth_apikey WHERE reference_id = '${member.id}'`)).toBe(
    0,
  );
  expect((await w.post(signedIn.cookie)).thread.id).toBeGreaterThan(0);
  // The next sign-in with Google is the same account and changes nothing more.
  const again = await w.signInWith("google");
  expect((await w.me(again.cookie))!.id).toBe(member.id);
  expect((await w.me(signedIn.cookie))!.id).toBe(member.id);
});

test("Google on an account with a confirmed address links it and keeps its password and sessions", async () => {
  const w = await world();
  const member = await w.register("Olga");
  w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
  const other = await passwordCookie(w, "olga@example.test");
  const sessions = w.sessions(member.id);
  fakeProviders({ google: { id: "g-41", name: "Olga", email: "olga@example.test" } });

  const signedIn = await w.signInWith("google");
  expect((await w.me(signedIn.cookie))!.id).toBe(member.id);
  expect(providersOf(w, member.id)).toEqual(["credential", "google"]);
  expect((await w.me(other))!.id).toBe(member.id);
  expect(w.sessions(member.id)).toBe(sessions + 1);
  expect(await passwordCookie(w, "olga@example.test")).toContain("session_token");
});

test("an address the provider has not verified does not link to an unconfirmed account, which keeps its password", async () => {
  const w = await world();
  const member = await w.register("Paula", 5);
  const other = await passwordCookie(w, "paula@example.test");
  fakeProviders({
    google: { id: "g-42", name: "Mallory", email: "paula@example.test", verified: false },
  });
  const signedIn = await w.signInWith("google");
  expect(signedIn.location!.pathname).toBe("/login");
  expect(signedIn.location!.searchParams.get("error")).toBe("account_not_linked");
  expect(signedIn.cookie).not.toContain("session_token");
  expect(providersOf(w, member.id)).toEqual(["credential"]);
  expect(emailVerified(w, member.id)).toBe(0);
  expect((await w.me(other))!.id).toBe(member.id);
});

test("Google confirms the address of an unconfirmed member who needs a username, who stays unconfirmed", async () => {
  const w = await world();
  const member = await w.register("Queta", 5);
  w.ctx.sqlite.prepare("UPDATE users SET needs_username = 1 WHERE id = ?1").run(member.id);
  fakeProviders({ google: { id: "g-43", name: "Queta", email: "queta@example.test" } });
  const signedIn = await w.signInWith("google");
  expect(await w.me(signedIn.cookie)).toMatchObject({
    id: member.id,
    needsUsername: true,
    groupId: 5,
  });
  expect(emailVerified(w, member.id)).toBe(1);
  expect(providersOf(w, member.id)).toEqual(["google"]);
});

test("a signed-in member who links Google by hand keeps the password, unconfirmed address or not", async () => {
  const w = await world();
  const member = await w.register("Rita", 5);
  const session = await passwordCookie(w, "rita@example.test");
  fakeProviders({ google: { id: "g-44", name: "Rita", email: "rita@example.test" } });
  const start = await w.auth("/link-social", {
    method: "POST",
    headers: { cookie: session },
    body: JSON.stringify({
      provider: "google",
      callbackURL: `${ORIGIN}/account`,
      disableRedirect: true,
    }),
  });
  expect(start.status).toBe(200);
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state")!;
  const back = await w.auth(`/callback/google?code=code-1&state=${encodeURIComponent(state)}`, {
    headers: { cookie: [...cookiesOf(start), session].join("; ") },
  });
  expect(back.headers.get("location")).toBe(`${ORIGIN}/account`);
  expect(providersOf(w, member.id)).toEqual(["credential", "google"]);
  expect((await w.me(session))!.id).toBe(member.id);
  expect(await passwordCookie(w, "rita@example.test")).toContain("session_token");
});

test("X without a shared address is refused and makes no account", async () => {
  const w = await world();
  fakeProviders({ twitter: { id: "1234", name: "nomail", email: null } });
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  const signedIn = await w.signInWith("twitter");
  expect(signedIn.location!.pathname).toBe("/login");
  expect(signedIn.location!.searchParams.get("error")).toBe("email_not_found");
  expect(signedIn.cookie).not.toContain("session_token");
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
});

test("X with a confirmed address signs a new member in, who needs a username", async () => {
  const w = await world();
  fakeProviders({ twitter: { id: "5678", name: "Yuni", email: "yuni@example.test" } });
  const { cookie } = await w.signInWith("twitter");
  expect(await w.me(cookie)).toMatchObject({ email: "yuni@example.test", needsUsername: true });
});

test("GitHub without any address is refused with the same code", async () => {
  const w = await world();
  fakeProviders({ github: { id: "88", name: "ghost", email: null } });
  const signedIn = await w.signInWith("github");
  expect(signedIn.location!.searchParams.get("error")).toBe("email_not_found");
});

test("while registration is closed a provider makes no new account", async () => {
  const w = await world();
  storeSiteSettings(w.ctx, { ...readSiteSettings(w.ctx), registrationOpen: false });
  fakeProviders({ google: { id: "g-7", name: "Late", email: "late@example.test" } });
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  const signedIn = await w.signInWith("google");
  expect(signedIn.location!.searchParams.get("error")).toBe("REGISTRATION_CLOSED");
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
});

test("a provisional username never takes a name in use", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-8", name: "founder", email: "other@example.test" } });
  const { cookie } = await w.signInWith("google");
  const user = (await w.me(cookie))!;
  expect(user.username.toLowerCase()).not.toBe("founder");
  expect(user.username).toMatch(/^founder\d+$/i);
});

test("a provider name that the rule refuses gives member and a number, never the address", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-9", name: "!!", email: "bang@example.test" } });
  const { cookie } = await w.signInWith("google");
  const user = (await w.me(cookie))!;
  expect(user.username).toMatch(/^member\d+$/);
});

test("a first name too short for the rule never puts the address in the provisional username", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-13", name: "Li Wei", email: "liwei1988@example.test" } });
  const { cookie } = await w.signInWith("google");
  const user = (await w.me(cookie))!;
  expect(user.username).toMatch(/^member\d+$/);
  expect(user.username.toLowerCase()).not.toContain("liwei");
});

test("the provisional username is the first word of the name, whatever separates the words", async () => {
  const w = await world();
  const name = (given: string) => provisionalUsername(w.ctx, given);
  expect(name("Juan,Pérez")).toBe("Juan");
  expect(name("Smith;John")).toBe("Smith");
  expect(name("Zoë\u200bX")).toBe("Zoë");
  expect(name("  María José  ")).toBe("María");
  expect(name("J. R. R. Tolkien")).toMatch(/^member\d+$/);
  expect(name("😀😀😀")).toMatch(/^member\d+$/);
  expect(name("   ")).toMatch(/^member\d+$/);
});

test("a provisional username with every numbered form taken is still a free name", async () => {
  const w = await world();
  const taken = new Set(["pedro"]);
  insertUser(w.ctx, { username: "Pedro", email: "pedro@example.test" });
  for (let n = 2; n <= 101; n++) {
    insertUser(w.ctx, { username: `Pedro${n}`, email: `pedro${n}@example.test` });
    taken.add(`pedro${n}`);
  }
  const value = provisionalUsername(w.ctx, "Pedro Gómez");
  expect(value).toMatch(/^Pedro\d+$/);
  expect(taken.has(value.toLowerCase())).toBe(false);
});

test("a stale session cookie stops neither the sign-in request nor the return from the provider", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-10", name: "Mara", email: "mara@example.test" } });
  const signedIn = await w.signInWith("google", "sermo.session_token=gone.sig");
  expect(signedIn.status).toBe(302);
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect(signedIn.cookie).toContain("sermo.session_token=");
  expect(await w.me(signedIn.cookie)).toMatchObject({ email: "mara@example.test" });
});

test("a provider address the provider has not verified makes no account", async () => {
  const w = await world();
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  for (const [provider, profile] of [
    ["google", { id: "g-20", name: "Ghost", email: "ghost@example.test", verified: false }],
    ["github", { id: "20", name: "ghost", email: "ghost@example.test", verified: false }],
  ] as const) {
    fakeProviders({ [provider]: profile });
    const signedIn = await w.signInWith(provider);
    expect(signedIn.location!.pathname).toBe("/login");
    expect(signedIn.location!.searchParams.get("error")).toBe("email_not_verified");
    expect(signedIn.cookie).not.toContain("session_token");
  }
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
});

test("a provider address the provider has not verified does not link to a confirmed member", async () => {
  const w = await world();
  const victim = await w.register("Victim");
  w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(victim.id);
  for (const [provider, profile] of [
    ["google", { id: "g-21", name: "Mallory", email: "victim@example.test", verified: false }],
    ["github", { id: "21", name: "mallory", email: "victim@example.test", verified: false }],
  ] as const) {
    fakeProviders({ [provider]: profile });
    const signedIn = await w.signInWith(provider);
    expect(signedIn.location!.pathname).toBe("/login");
    expect(signedIn.location!.searchParams.get("error")).toBe("account_not_linked");
    expect(signedIn.cookie).not.toContain("session_token");
  }
  expect(w.count(`SELECT count(*) AS n FROM auth_account WHERE user_id = ${victim.id}`)).toBe(1);
});

test("a provider address the provider verified links to a confirmed member once, without a second account", async () => {
  const w = await world();
  const member = await w.register("Linda");
  w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
  fakeProviders({
    github: { id: "22", name: "linda", email: "linda@example.test", verified: true },
  });
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  for (const _ of [1, 2]) {
    const signedIn = await w.signInWith("github");
    expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
    expect((await w.me(signedIn.cookie))!.id).toBe(member.id);
  }
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
  expect(w.count(`SELECT count(*) AS n FROM auth_account WHERE user_id = ${member.id}`)).toBe(2);
});

test("the provider tokens are not stored in plain text", async () => {
  const w = await world();
  fakeProviders({ github: { id: "23", name: "Tokio", email: "tokio@example.test" } });
  await w.signInWith("github");
  const stored = w.ctx.sqlite
    .prepare<{ access_token: string | null }, []>(
      "SELECT access_token FROM auth_account WHERE provider_id = 'github'",
    )
    .get()!;
  expect(stored.access_token).toBeString();
  expect(stored.access_token).not.toContain("github-access");
});

test("a failure after the rename leaves the member able to choose again", async () => {
  const w = await world();
  await w.run("pages.save", w.founder.actor, {
    slug: "terms",
    title: "Terms",
    body: "Read me.",
    isPublished: true,
  });
  fakeProviders({ google: { id: "g-24", name: "Otto", email: "otto@example.test" } });
  const { cookie } = await w.signInWith("google");
  const actor = await w.actorOf(cookie);
  w.ctx.sqlite.run(
    "CREATE TEMP TRIGGER refuse_terms BEFORE INSERT ON terms_acceptances BEGIN SELECT RAISE(ABORT, 'disk full'); END",
  );
  await expect(
    w.run("auth.chooseUsername", actor, { username: "Otto Uno", acceptTerms: true }),
  ).rejects.toThrow("disk full");
  expect(await w.me(cookie)).toMatchObject({ needsUsername: true, groupId: 5 });
  w.ctx.sqlite.run("DROP TRIGGER refuse_terms");
  await w.run("auth.chooseUsername", actor, { username: "Otto Dos", acceptTerms: true });
  expect(await w.me(cookie)).toMatchObject({
    username: "Otto Dos",
    needsUsername: false,
    groupId: 2,
    pendingAcceptance: [],
  });
});

test("of two choices sent close together exactly one wins, and the stored name is the winner's", async () => {
  const w = await world();
  // The second request starts a few microtask turns after the first, so it meets the first at
  // each of its steps (before the rename, during it, after the commit).
  for (let turns = 0; turns <= 60; turns += 3) {
    fakeProviders({
      google: { id: `g-race-${turns}`, name: "Gemelo", email: `gemelo${turns}@example.test` },
    });
    const { cookie } = await w.signInWith("google");
    const actor = await w.actorOf(cookie);
    const choose = (username: string) =>
      w.run("auth.chooseUsername", actor, { username, acceptTerms: true });
    const first = choose(`Primero ${turns}`);
    for (let n = 0; n < turns; n++) await Promise.resolve();
    const results = await Promise.allSettled([first, choose(`Segundo ${turns}`)]);
    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result) => result.status === "rejected");
    expect({ turns, won: won.length, lost: lost.length }).toEqual({ turns, won: 1, lost: 1 });
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    const winner = (won[0] as PromiseFulfilledResult<{ username: string }>).value.username;
    const me = (await w.me(cookie))!;
    expect({ turns, username: me.username, needsUsername: me.needsUsername }).toEqual({
      turns,
      username: winner,
      needsUsername: false,
    });
    expect(
      w.ctx.sqlite
        .prepare<{ username: string }, [number]>("SELECT username FROM auth_user WHERE id = ?1")
        .get(me.id)!.username,
    ).toBe(winner.toLowerCase());
  }
});

test("a provider sign-in that verifies the address of an unconfirmed member promotes them", async () => {
  const w = await world();
  const member = await w.register("Uma", 5);
  // Google is linked already (through Better Auth's own link endpoint); the address is not
  // confirmed yet.
  w.ctx.sqlite
    .prepare(
      "INSERT INTO auth_account (account_id, provider_id, user_id, created_at, updated_at) VALUES ('g-26', 'google', ?1, ?2, ?2)",
    )
    .run(member.id, w.ctx.now());
  fakeProviders({ google: { id: "g-26", name: "Uma", email: "uma@example.test" } });
  const signedIn = await w.signInWith("google");
  expect(signedIn.location!.href).toBe(`${ORIGIN}/`);
  expect(await w.me(signedIn.cookie)).toMatchObject({ id: member.id, groupId: 2 });
  expect(
    w.ctx.sqlite
      .prepare<{ email_verified: number }, [number]>(
        "SELECT email_verified FROM auth_user WHERE id = ?1",
      )
      .get(member.id)!.email_verified,
  ).toBe(1);
});

/** A Google key pair, its public half served as Google's certificates, and id tokens it signs. */
async function fakeGoogleKeys() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
    throw new Error(`Unexpected request to ${url}`);
  }) as typeof fetch;
  return async (claims: object) => {
    const now = Math.floor(Date.now() / 1000);
    const head = base64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }));
    const body = base64url(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: CREDENTIALS.google.clientId,
        iat: now,
        exp: now + 600,
        ...claims,
      }),
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${head}.${body}`),
    );
    return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
  };
}

test("Google One Tap signs a new member in, who needs a username", async () => {
  const w = await world({ google: CREDENTIALS.google });
  const sign = await fakeGoogleKeys();
  const response = await w.auth("/one-tap/callback", {
    method: "POST",
    body: JSON.stringify({
      idToken: await sign({
        sub: "g-11",
        email: "tap@example.test",
        email_verified: true,
        name: "Tap Tap",
      }),
    }),
  });
  expect(response.status).toBe(200);
  const cookie = cookiesOf(response).join("; ");
  expect(await w.me(cookie)).toMatchObject({
    email: "tap@example.test",
    username: "Tap",
    needsUsername: true,
    groupId: 5,
  });
});

test("Google One Tap links only an address Google verified, and makes no account for one it did not", async () => {
  const w = await world({ google: CREDENTIALS.google });
  const member = await w.register("Tina");
  w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member.id);
  const sign = await fakeGoogleKeys();
  const tap = async (claims: object) =>
    w.auth("/one-tap/callback", {
      method: "POST",
      body: JSON.stringify({ idToken: await sign({ name: "Tina", ...claims }) }),
    });
  const users = w.count("SELECT count(*) AS n FROM auth_user");
  const refused = await tap({ sub: "g-30", email: "tina@example.test", email_verified: false });
  expect(refused.status).toBe(401);
  expect(await refused.json()).toEqual({ message: "account not linked" });
  expect(cookiesOf(refused).join("; ")).not.toContain("session_token");
  const unknown = await tap({ sub: "g-31", email: "nobody@example.test", email_verified: false });
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ code: "email_not_verified" });
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
  expect(w.count(`SELECT count(*) AS n FROM auth_account WHERE user_id = ${member.id}`)).toBe(1);
  const linked = await tap({ sub: "g-32", email: "tina@example.test", email_verified: true });
  expect(linked.status).toBe(200);
  expect((await w.me(cookiesOf(linked).join("; ")))!.id).toBe(member.id);
  expect(w.count("SELECT count(*) AS n FROM auth_user")).toBe(users);
});

test("an account made by a password sign-up never needs a username", async () => {
  const w = await world();
  const member = await w.register("Plain");
  const signed = await w.signIn("plain@example.test", PASSWORD);
  expect(Number(signed.user.id)).toBe(member.id);
  expect(
    w.ctx.sqlite
      .prepare<{ needs_username: number }, [number]>(
        "SELECT needs_username FROM users WHERE id = ?1",
      )
      .get(member.id)!.needs_username,
  ).toBe(0);
});

test("a provider account whose forum row is missing is repaired as one that needs a username", async () => {
  const w = await world();
  fakeProviders({ google: { id: "g-12", name: "Rey", email: "rey@example.test" } });
  const { cookie } = await w.signInWith("google");
  const { id } = (await w.me(cookie))!;
  w.ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(id);
  expect(await w.me(cookie)).toMatchObject({ id, needsUsername: true, groupId: 5 });
});

test("a provider return that lost its sign-in goes to the site's sign-in page with the code", async () => {
  const w = await world();
  const noState = await w.auth("/callback/google?code=code-1");
  expect(noState.status).toBe(302);
  const lost = new URL(noState.headers.get("location")!, ORIGIN);
  expect(lost.pathname).toBe("/login");
  expect(lost.searchParams.get("error")).toBe("state_not_found");
  // A state the browser no longer holds the cookie of (it took too long, or the cookie was blocked).
  const start = await w.auth("/sign-in/social", {
    method: "POST",
    body: JSON.stringify({
      provider: "google",
      callbackURL: `${ORIGIN}/`,
      errorCallbackURL: `${ORIGIN}/login?via=google`,
      disableRedirect: true,
    }),
  });
  const state = new URL(((await start.json()) as { url: string }).url).searchParams.get("state")!;
  const stale = await w.auth(`/callback/google?code=code-1&state=${encodeURIComponent(state)}`);
  const where = new URL(stale.headers.get("location")!, ORIGIN);
  expect(where.pathname).toBe("/login");
  expect(where.searchParams.get("error")).toMatch(/^state_/);
});

test("Better Auth's own error page sends the visitor to the site's sign-in page instead", async () => {
  const w = await world();
  const answer = await w.auth("/error?error=invalid_callback_request");
  expect(answer.status).toBe(302);
  expect(answer.headers.get("location")).toBe("/login?error=invalid_callback_request");
});
