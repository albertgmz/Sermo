import type { Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

export const scenarios: Scenario[] = [
  {
    name: "auth.login",
    kind: "write",
    async run(env, i) {
      const id = env.meta.memberIds[i % env.meta.memberIds.length]!;
      const row = env.ctx.sqlite
        .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
        .get(id)!;
      return env.call("auth.login", env.actors.guest, {
        login: row.username,
        password: SEED_PASSWORD,
      });
    },
  },
  {
    name: "auth.register",
    kind: "write",
    run(env, i) {
      return env.call("auth.register", env.actors.guest, {
        username: `BenchMember${i}_${crypto.randomUUID().slice(0, 8)}`,
        email: `bench-${i}-${crypto.randomUUID()}@example.test`,
        password: SEED_PASSWORD,
      });
    },
  },
  {
    name: "auth.me member",
    kind: "read",
    run: (env, i) => env.call("auth.me", env.actors.member(i), {}),
  },
  { name: "auth.me guest", kind: "read", run: (env) => env.call("auth.me", env.actors.guest, {}) },
];
