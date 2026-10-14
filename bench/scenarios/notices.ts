import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "notices.current guest",
    kind: "read",
    async setup(env) {
      for (const [title, audience] of [
        ["Bench notice for everyone", "everyone"],
        ["Bench notice for guests", "guests"],
        ["Bench notice for members", "members"],
      ] as const)
        await env.call("notices.create", env.actors.admin, {
          title,
          body: "A notice shown on every page.",
          audience,
          groupId: null,
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
