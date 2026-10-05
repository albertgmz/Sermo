import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "seo.thread big public page",
    kind: "read",
    run: (env) =>
      env.call("seo.thread", env.actors.admin, {
        threadId: env.meta.bigThreadIds[0],
        page: 1,
        pageSize: 20,
      }),
  },
  {
    name: "seo.node populated forum",
    kind: "read",
    run: (env) => env.call("seo.node", env.actors.admin, { nodeId: env.meta.bigForumIds[0] }),
  },
  {
    name: "seo.profile active user",
    kind: "read",
    run: (env) => env.call("seo.profile", env.actors.admin, { userId: env.meta.memberIds[0] }),
  },
  {
    name: "seo.sitemap index generation",
    kind: "read",
    iterations: 3,
    budgetExempt: "sitemap generation",
    async run(env) {
      const response = await env.request("/sitemap.xml");
      if (!response.ok) throw new Error(`Sitemap returned ${response.status}`);
      await response.text();
    },
  },
  {
    name: "seo.feed site",
    kind: "read",
    async run(env) {
      const response = await env.request("/feed.atom");
      if (!response.ok) throw new Error(`Feed returned ${response.status}`);
      await response.text();
    },
  },
  {
    name: "seo.feed populated node",
    kind: "read",
    async run(env) {
      const response = await env.request(`/nodes/${env.meta.bigForumIds[0]}/feed.atom`);
      if (!response.ok) throw new Error(`Node feed returned ${response.status}`);
      await response.text();
    },
  },
];
