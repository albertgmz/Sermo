import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Ok, Timestamp } from "./common";

/*
 * Pages of text the site publishes about itself: terms, privacy, a legal notice, contact
 * details, a list of questions. An administrator writes them in Markdown; they are rendered and
 * sanitised when saved, like every other body.
 */

/** Longer than a post: legal texts run long. Only administrators write pages. */
const PageBody = z.string().trim().min(1).max(50_000);

export const PageSlug = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/, "Use lower-case letters, digits and hyphens.");

export const StaticPage = z
  .object({
    slug: z.string(),
    title: z.string(),
    bodyHtml: z.string(),
    isPublished: z.boolean(),
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
    "found, except for holders of admin.settings.",
  kind: "read",
  input: z.object({ slug: PageSlug }),
  output: StaticPage,
});

export const pagesList = defineContract({
  name: "pages.list",
  summary:
    "Every page with its Markdown source, published or not, ordered by slug (at most 100 " +
    "exist). Requires admin.settings.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(StaticPageDetail) }),
});

export const pagesSave = defineContract({
  name: "pages.save",
  summary:
    "Create the page with this slug, or replace its title, text and published state. Requires " +
    "admin.settings.",
  kind: "write",
  input: z.object({
    slug: PageSlug,
    title: z.string().trim().min(1).max(150),
    body: PageBody,
    isPublished: z.boolean().default(true),
  }),
  output: StaticPageDetail,
});

export const pagesDelete = defineContract({
  name: "pages.delete",
  summary:
    "Delete a page. Navigation entries that point at it are left alone. Requires admin.settings.",
  kind: "write",
  input: z.object({ slug: PageSlug }),
  output: Ok,
});
