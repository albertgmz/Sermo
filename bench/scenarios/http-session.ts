/**
 * Reads authenticated with a Better Auth session cookie, through the full HTTP app, as a browser
 * would send them: the session token plus the cookie cache, refreshed from Set-Cookie.
 */
import { getAuth } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

const cookies = new Map<string, string>();

function remember(setCookies: string[]): void {
  for (const header of setCookies) {
    const [pair] = header.split(";");
    const index = pair!.indexOf("=");
    cookies.set(pair!.slice(0, index), pair!.slice(index + 1));
  }
}

function cookieHeader(): string {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function signIn(env: BenchEnv): Promise<void> {
  if (cookies.size > 0) return;
  const email = env.ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(env.meta.memberIds[1]!)!.email;
  const { headers } = await getAuth(env.ctx).api.signInEmail({
    body: { email, password: SEED_PASSWORD },
    returnHeaders: true,
  });
  remember(headers.getSetCookie());
}

async function get(env: BenchEnv, path: string): Promise<string> {
  const response = await env.request(path, { headers: { cookie: cookieHeader() } });
  remember(response.headers.getSetCookie());
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status} ${text}`);
  return text;
}

export const scenarios: Scenario[] = [
  {
    name: "http: posts page, session cookie",
    kind: "read",
    setup: signIn,
    run(env, i) {
      const threadId = env.meta.bigThreadIds[i % env.meta.bigThreadIds.length]!;
      return get(env, `/api/v1/threads/${threadId}/posts?page=${1 + ((i * 37) % 400)}`);
    },
  },
  {
    name: "http: nodes list, session cookie",
    kind: "read",
    setup: signIn,
    run: (env) => get(env, "/api/v1/nodes"),
  },
];
