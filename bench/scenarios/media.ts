import type { Scenario } from "../harness";

/*
 * The home page's Media tab and the home tab choice. The seeded attachments are all JPEG images
 * on the oldest 300,000 posts, so the listing walks real rows. Read-only, but the home tab rules
 * are written in `setup` and put back in `teardown`.
 */

let secondPage = "";

const rules = {
  rules: [
    { rule: { match: "all", conditions: [{ criterion: "is_guest", value: 1 }] }, tab: "hot" },
    {
      rule: { match: "all", conditions: [{ criterion: "post_count", value: 100 }] },
      tab: "forums",
    },
    { rule: { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] }, tab: "following" },
  ],
  fallback: "latest",
};

export const scenarios: Scenario[] = [
  {
    name: "media.list guest",
    kind: "read",
    run: (env) => env.call("media.list", env.actors.guest, { limit: 24 }),
  },
  {
    name: "media.list member",
    kind: "read",
    run: (env, i) => env.call("media.list", env.actors.member(i), { limit: 24 }),
  },
  {
    // A later page: the cursor of the first page, read once, then the same seek for everyone.
    name: "media.list second page",
    kind: "read",
    async setup(env) {
      // `env.call` answers the response text, as the API sends it.
      const first = JSON.parse(
        (await env.call("media.list", env.actors.guest, { limit: 24 })) as string,
      ) as { nextCursor: string | null };
      if (!first.nextCursor) throw new Error("The seed has fewer than 24 pictures.");
      secondPage = first.nextCursor;
    },
    run: (env, i) =>
      env.call("media.list", env.actors.member(i), { limit: 24, cursor: secondPage }),
  },
  {
    name: "site.homeTab guest",
    kind: "read",
    async setup(env) {
      await env.call("settings.update", env.actors.admin, { homeTab: rules });
    },
    async teardown(env) {
      await env.call("settings.update", env.actors.admin, {
        homeTab: { rules: [], fallback: "latest" },
      });
    },
    run: (env) => env.call("site.homeTab", env.actors.guest, {}),
  },
  {
    // Three rules: the member's facts are loaded once, whatever the number of rules.
    name: "site.homeTab member",
    kind: "read",
    async setup(env) {
      await env.call("settings.update", env.actors.admin, { homeTab: rules });
    },
    async teardown(env) {
      await env.call("settings.update", env.actors.admin, {
        homeTab: { rules: [], fallback: "latest" },
      });
    },
    run: (env, i) => env.call("site.homeTab", env.actors.member(i), {}),
  },
];
