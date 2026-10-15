import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Ok, Timestamp } from "./common";

/*
 * Pages of text the site publishes about itself: terms, privacy, a legal notice, contact
 * details, a list of questions. An administrator writes them in BB code; they are rendered and
 * sanitised when saved, like every other body.
 */

/**
 * Twice a post: legal texts run long, and only administrators write pages. Not more: rendering
 * cost grows faster than linearly on adversarial input, and at 20,000 characters the worst cases
 * measured take about 1.6 s. A longer text is split over several pages.
 */
export const PAGE_BODY_LENGTH = 20_000;
const PageBody = z.string().trim().min(1).max(PAGE_BODY_LENGTH);

export const PageSlug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "Use lower-case letters, digits and hyphens.");

export const StaticPage = z
  .object({
    slug: z.string(),
    title: z.string(),
    bodyHtml: z.string(),
    isPublished: z.boolean(),
    /**
     * Raised only when an administrator saves the page "as a new version". For the `terms` and
     * `rules` pages it is the version members must accept (see `terms.accept`).
     */
    version: z.number().int().positive(),
    updatedAt: Timestamp,
  })
  .meta({ id: "StaticPage" });

export const StaticPageDetail = StaticPage.extend({ bodySource: z.string() }).meta({
  id: "StaticPageDetail",
});

export const pagesGet = defineContract({
  name: "pages.get",
  summary:
    "One published page by its slug. Open to everyone. A page that is not published is not " +
    "found, except for holders of admin.pages.",
  kind: "read",
  input: z.object({ slug: PageSlug }),
  output: StaticPage,
});

export const pagesList = defineContract({
  name: "pages.list",
  summary:
    "Every page, published or not, without its text, ordered by slug (at most 100 exist). " +
    "Requires admin.pages.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(
      z.object({
        slug: z.string(),
        title: z.string(),
        isPublished: z.boolean(),
        version: z.number().int().positive(),
        updatedAt: Timestamp,
      }),
    ),
  }),
});

export const pagesGetSource = defineContract({
  name: "pages.getSource",
  summary: "One page with its BB code source, published or not. Requires admin.pages.",
  kind: "read",
  input: z.object({ slug: PageSlug }),
  output: StaticPageDetail,
});

export const pagesSave = defineContract({
  name: "pages.save",
  summary:
    "Create the page with this slug, or replace its title, text and published state. A new " +
    "page starts at version 1; `newVersion` raises the version by one, which for the `terms` " +
    "and `rules` pages makes every member accept it again before they can post, react or " +
    "message (`newVersion` on a page that does not exist yet changes nothing). Fixing a typo " +
    "leaves it false. Requires admin.pages.",
  kind: "write",
  input: z.object({
    slug: PageSlug,
    title: z.string().trim().min(1).max(150),
    body: PageBody,
    isPublished: z.boolean().default(true),
    newVersion: z.boolean().default(false),
  }),
  output: StaticPageDetail,
});

export const pagesDelete = defineContract({
  name: "pages.delete",
  summary:
    "Delete a page. Navigation entries that point at it are left alone. Requires admin.pages.",
  kind: "write",
  input: z.object({ slug: PageSlug }),
  output: Ok,
});
