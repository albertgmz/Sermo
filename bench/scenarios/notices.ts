import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "notices.current guest",
    kind: "read",
    async setup(env) {
      for (const [title, conditions] of [
        ["Bench notice for everyone", []],
        ["Bench notice for guests", [{ criterion: "is_guest", value: 1 }]],
        ["Bench notice for members", [{ criterion: "is_guest", value: 0 }]],
      ] as const)
        await env.call("notices.create", env.actors.admin, {
          title,
          body: "A notice shown on every page.",
          rule: { match: "all", conditions },
          dismissible: true,
          active: true,
          startsAt: null,
          endsAt: null,
        });
    },
    run: (env) => env.call("notices.current", env.actors.guest, {}),
  },
  {
    name: "notices.current member",
    kind: "read",
    run: (env, i) => env.call("notices.current", env.actors.member(i), {}),
  },
];
