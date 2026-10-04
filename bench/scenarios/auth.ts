import type { Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

let loginNames: string[] = [];
export const scenarios: Scenario[] = [
  {
    name: "auth.login",
    kind: "write",
    setup(env) {
      const byId = env.ctx.sqlite.prepare<{ username: string }, [number]>(
        "SELECT username FROM users WHERE id = ?1",
      );
      loginNames = env.meta.memberIds.map((id) => byId.get(id)!.username);
    },
    async run(env, i) {
      return env.call("auth.login", env.actors.guest, {
        login: loginNames[i % loginNames.length]!,
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
