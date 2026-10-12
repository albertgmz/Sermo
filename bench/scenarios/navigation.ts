import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "navigation.get guest",
    kind: "read",
    run: (env) => env.call("navigation.get", env.actors.guest, {}),
  },
  {
    name: "navigation.get member",
    kind: "read",
    run: (env, i) => env.call("navigation.get", env.actors.member(i), {}),
  },
  {
    name: "pages.get",
    kind: "read",
    async setup(env) {
      await env.call("pages.save", env.actors.admin, {
        slug: "bench-terms",
        title: "Terms",
        body: "Terms of use.\n\n".repeat(200),
        isPublished: true,
      });
    },
    run: (env) => env.call("pages.get", env.actors.guest, { slug: "bench-terms" }),
  },
];
