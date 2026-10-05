import { getAuth, resolveActor } from "../../packages/core/src/modules/auth";
import type { Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

let sessionHeaders: Headers;
let keyHeaders: Headers;
let email: string;
let signupNumber = 0;
let signupRun: string;

async function setup(env: Parameters<NonNullable<Scenario["setup"]>>[0]) {
  signupRun = Date.now().toString(36);
  env.ctx.config.auth ??= {
    secret: "benchmark-secret-for-sermo-0123456789abcdef",
    baseURL: "http://localhost:3000",
    trustedOrigins: [],
    clientIpHeader: "x-sermo-client-ip",
  };
  const user = env.ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(env.meta.memberIds[0]!)!;
  email = user.email;
  const response = await getAuth(env.ctx).api.signInEmail({
    body: { email, password: SEED_PASSWORD },
    asResponse: true,
  });
  sessionHeaders = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; "),
  });
  const key = await getAuth(env.ctx).api.createApiKey({
    headers: sessionHeaders,
    body: { name: "Benchmark" },
  });
  keyHeaders = new Headers({ authorization: `Bearer ${key.key}` });
}

export const scenarios: Scenario[] = [
  {
    name: "auth.resolveActor session",
    kind: "read",
    setup,
    run: (env) => resolveActor(env.ctx, sessionHeaders),
  },
  {
    name: "auth.resolveActor api key",
    kind: "read",
    setup,
    run: (env) => resolveActor(env.ctx, keyHeaders),
  },
  {
    name: "auth.me",
    kind: "read",
    setup,
    run: (env) => env.call("auth.me", env.actors.user(env.meta.memberIds[0]!), {}),
  },
  {
    name: "auth.signIn email",
    kind: "write",
    budgetExempt: "password hashing",
    setup,
    run: (env) => getAuth(env.ctx).api.signInEmail({ body: { email, password: SEED_PASSWORD } }),
  },
  {
    name: "auth.signUp email",
    kind: "write",
    budgetExempt: "password hashing",
    setup,
    run: (env) => {
      const n = ++signupNumber;
      return getAuth(env.ctx).api.signUpEmail({
        body: {
          name: `Bench ${n}`,
          username: `bench_${signupRun}_${n}`,
          email: `bench_${signupRun}_${n}@example.test`,
          password: SEED_PASSWORD,
        },
      });
    },
  },
];
