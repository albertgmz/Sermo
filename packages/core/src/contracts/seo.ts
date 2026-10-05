import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id } from "./common";

export const SeoMetadata = z.object({
  title: z.string(),
  description: z.string(),
  canonical: z.url(),
  robots: z.enum(["index,follow", "noindex,follow"]),
  redirect: z.boolean(),
  jsonLd: z.array(z.unknown()),
});

export const seoNode = defineContract({
  name: "seo.node",
  summary: "Canonical metadata and redirect decision for a node path.",
  kind: "read",
  input: z.object({ nodeId: Id, requestedPath: z.string().max(2048).default("") }),
  output: SeoMetadata,
});
export const seoThread = defineContract({
  name: "seo.thread",
  summary: "Canonical metadata and structured data for a thread page.",
  kind: "read",
  input: z.object({
    threadId: Id,
    requestedPath: z.string().max(2048).default(""),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(20),
  }),
  output: SeoMetadata,
});
export const seoProfile = defineContract({
  name: "seo.profile",
  summary: "Canonical metadata and redirect decision for a public profile.",
  kind: "read",
  input: z.object({ userId: Id, requestedPath: z.string().max(2048).default("") }),
  output: SeoMetadata,
});
export const seoSearch = defineContract({
  name: "seo.search",
  summary: "Search result pages must not be indexed.",
  kind: "read",
  input: Empty,
  output: z.object({ robots: z.literal("noindex,follow") }),
});
