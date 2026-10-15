export { queueSeoEvents, registerSeoJobs } from "./delivery";
export { excerptFromMarkdown } from "./excerpt";
export { atomFeed } from "./feeds";
export { indexNowBatches, sendIndexNow } from "./indexnow";
export { LLMS_FORUM_CAP, llmsTxt } from "./llms";
export type { SeoPage, SeoTemplates } from "./pages";
export { nodeSeo, profileSeo, searchSeo, threadSeo } from "./pages";
export { canonicalPath, canonicalUrl, requireBaseURL, resolveCanonical } from "./paths";
export { robotsTxt, SITEMAP_CAP, sitemapEntries, sitemapIndex, sitemapShard } from "./sitemap";

import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { seoNode, seoProfile, seoSearch, seoThread } from "../../contracts/seo";
import { implement } from "../../operation";
import { requireSiteView } from "../members/site-access";
import { readSiteSettings } from "../settings";
import { nodeSeo, profileSeo, threadSeo } from "./pages";

function config(ctx: Ctx) {
  const settings = readSiteSettings(ctx);
  return {
    baseURL: ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000",
    templates: {
      siteName: settings.siteName,
      nodeTitle: settings.nodeTitleTemplate,
      threadTitle: settings.threadTitleTemplate,
      profileTitle: settings.profileTitleTemplate,
    },
  };
}

export function seoForNode(ctx: Ctx, actor: Actor, id: number, requestedPath = "") {
  const { baseURL, templates } = config(ctx);
  return nodeSeo(ctx, actor, baseURL, id, requestedPath, templates);
}
export function seoForThread(
  ctx: Ctx,
  actor: Actor,
  id: number,
  requestedPath = "",
  page = 1,
  pageSize = 20,
) {
  const { baseURL, templates } = config(ctx);
  return threadSeo(ctx, actor, baseURL, id, requestedPath, templates, page, pageSize);
}
export function seoForProfile(ctx: Ctx, actor: Actor, id: number, requestedPath = "") {
  const { baseURL, templates } = config(ctx);
  return profileSeo(ctx, actor, baseURL, id, requestedPath, templates);
}

export const operations = [
  implement(seoNode, (ctx, actor, input) => {
    requireSiteView(ctx, actor);
    return seoForNode(ctx, actor, input.nodeId, input.requestedPath);
  }),
  implement(seoThread, (ctx, actor, input) => {
    requireSiteView(ctx, actor);
    return seoForThread(
      ctx,
      actor,
      input.threadId,
      input.requestedPath,
      input.page,
      input.pageSize,
    );
  }),
  implement(seoProfile, (ctx, actor, input) => {
    requireSiteView(ctx, actor);
    return seoForProfile(ctx, actor, input.userId, input.requestedPath);
  }),
  implement(seoSearch, () => ({ robots: "noindex,follow" as const }), {
    public: "Search SEO metadata contains no private content",
  }),
];
