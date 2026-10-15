/**
 * The address log: the three staff views (`users.ips`, `ips.members`, `ips.content`) and the two
 * reads a member makes of their own record (`auth.signInHistory`, `auth.sessionDevices`, which
 * only a browser session may ask, so they go through a session cookie). The seed holds no log
 * rows, so `seed` gives one member a few thousand (posts, sign-ins, failed sign-ins) and one
 * address a crowd of members; it is idempotent.
 */
import { getAuth } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

const SHARED_IP = "203.0.113.200";
const HISTORY_ROWS = 3000;
const SHARED_MEMBERS = 30;
const BROWSERS: [string, string][] = [
  ["Chrome", "Windows"],
  ["Firefox", "GNU/Linux"],
  ["Mobile Safari", "iOS"],
  ["Chrome Mobile", "Android"],
];
const COUNTRIES = ["ES", "FR", "DE", "US"];

let loggedMemberId = 0;
const cookies = new Map<string, string>();

function seed(env: BenchEnv): void {
  loggedMemberId = env.meta.memberIds[1]!;
  const marked = env.ctx.sqlite
    .prepare<{ n: number }, [number, string]>(
      "SELECT count(*) AS n FROM ip_log WHERE user_id = ?1 AND ip = ?2",
    )
    .get(loggedMemberId, "198.51.100.1")!.n;
  if (marked > 0) return;
  const insert = env.ctx.sqlite.prepare(
    "INSERT INTO ip_log (user_id, ip, ip_net, action, content_type, content_id, browser, os, device_type, is_bot, country, region, city, created_at) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, 'desktop', 0, ?8, NULL, NULL, ?9)",
  );
  const now = Date.now();
  env.ctx.sqlite.transaction(() => {
    for (let n = 0; n < HISTORY_ROWS; n++) {
      const [browser, os] = BROWSERS[n % BROWSERS.length]!;
      const action = n % 10 === 0 ? "sign_in" : n % 37 === 0 ? "sign_in_failed" : "post";
      const post = env.meta.postAuthors[n % env.meta.postAuthors.length]!;
      insert.run(
        loggedMemberId,
        `198.51.100.${1 + (n % 20)}`,
        action,
        action === "post" ? "post" : null,
        action === "post" ? post[0] : null,
        browser,
        os,
        COUNTRIES[n % COUNTRIES.length]!,
        now - n * 60_000,
      );
    }
    env.meta.memberIds.slice(0, SHARED_MEMBERS).forEach((userId, at) => {
      for (let n = 0; n < 5; n++)
        insert.run(
          userId,
          SHARED_IP,
          "sign_in",
          null,
          null,
          "Chrome",
          "Windows",
          "ES",
          now - at * n,
        );
    });
    const [postId, authorId] = env.meta.postAuthors[0]!;
    insert.run(authorId, SHARED_IP, "post", "post", postId, "Chrome", "Windows", "ES", now);
  })();
}

async function signIn(env: BenchEnv): Promise<void> {
  seed(env);
  if (cookies.size > 0) return;
  const email = env.ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(loggedMemberId)!.email;
  const { headers } = await getAuth(env.ctx).api.signInEmail({
    body: { email, password: SEED_PASSWORD },
    returnHeaders: true,
  });
  for (const header of headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair!.indexOf("=");
    cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
  }
}

async function own(env: BenchEnv, path: string): Promise<string> {
  const cookie = [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  const response = await env.request(path, { headers: { cookie } });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status} ${text}`);
  return text;
}

export const scenarios: Scenario[] = [
  {
    name: "users.ips member with thousands of rows",
    kind: "read",
    setup: seed,
    run: (env) => env.call("users.ips", env.actors.admin, { userId: loggedMemberId, limit: 20 }),
  },
  {
    name: "ips.members address shared by a crowd",
    kind: "read",
    setup: seed,
    run: (env) => env.call("ips.members", env.actors.admin, { ip: SHARED_IP, limit: 20 }),
  },
  {
    name: "ips.content one post",
    kind: "read",
    setup: seed,
    run: (env) =>
      env.call("ips.content", env.actors.admin, {
        contentType: "post",
        contentId: env.meta.postAuthors[0]![0],
      }),
  },
  {
    name: "auth.signInHistory 20 entries, session cookie",
    kind: "read",
    setup: signIn,
    run: (env) => own(env, "/api/v1/me/sign-in-history?limit=20"),
  },
  {
    name: "auth.sessionDevices with place and last use, session cookie",
    kind: "read",
    setup: signIn,
    run: (env) => own(env, "/api/v1/me/session-devices"),
  },
];
