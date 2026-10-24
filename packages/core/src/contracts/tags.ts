import * as z from "zod";
import { defineContract } from "../operation";
import { Id, Ok, Page, pageInput, TagInput, Timestamp } from "./common";
import { Thread } from "./forums";
import { SeoMetadata } from "./seo";

/** The most threads a tag's numbered pages hold, as XenForo's tag page (its maximumSearchResults). */
export const TAG_PAGES_MAX = 500;

const TagName = z.string().max(120).describe("A tag name, as typed (with or without the #).");

export const TagAdmin = z
  .object({
    id: Id,
    name: z.string(),
    /** Threads that carry the tag, whatever their state or forum. */
    threadCount: z.number().int().nonnegative(),
    /** Earlier names (renames and merges) that still reach this tag. */
    aliases: z.array(z.string()),
    createdAt: Timestamp,
  })
  .meta({ id: "TagAdmin" });

export const tagsGet = defineContract({
  name: "tags.get",
  summary:
    "A tag's page header: its name, SEO metadata and whether the address asked for is not the " +
    "tag's current name (`redirect`: an old name of a renamed or merged tag). Not found when no " +
    "such tag exists or the viewer can see none of its threads, so a tag never reveals a thread " +
    "or forum the viewer cannot open. The page is indexable only with at least 3 threads " +
    "open to guests (it is `noindex` below that). Requires site.view.",
  kind: "read",
  input: z.object({ name: TagName, requestedPath: z.string().max(2048).default("") }),
  output: z.object({ name: z.string(), redirect: z.boolean(), seo: SeoMetadata }),
});

export const tagsThreads = defineContract({
  name: "tags.threads",
  summary:
    "The threads carrying a tag, newest activity first (the later of the last post and the " +
    "last bump), paged by cursor or by number. It applies the rules of a forum's thread list: forums the " +
    "viewer cannot open, other members' threads where forum.viewOthers is closed, hidden " +
    "states (moderated, deleted) only to those who may see them, merged threads out. Threads " +
    "hold the tag; hashtags typed in replies and private conversations do not. Not found like " +
    "tags.get. Requires site.view. `page` (from 1; a `cursor` takes precedence over it) is " +
    "the page of `limit` threads at that place in the list; with it, `total` is how many threads " +
    "the numbered pages hold for the viewer (`ceil(total / limit)` pages), null without it. " +
    "As on XenForo's tag " +
    `page, they hold at most the newest ${TAG_PAGES_MAX} threads the viewer may see, and they ` +
    "end sooner where placing the next thread would cost more than one request may spend (a " +
    "long run of threads the viewer may not see); a cursor walks on past both.",
  kind: "read",
  input: z.object({ name: TagName, page: z.number().int().min(1).optional(), ...pageInput }),
  output: Page(Thread).extend({ total: z.number().int().nonnegative().nullable() }),
});

export const tagsList = defineContract({
  name: "tags.list",
  summary:
    "Every tag by name, cursor-paged, optionally those starting with `query`, with how many " +
    "threads carry each and its earlier names. Requires tag.manage.",
  kind: "read",
  input: z.object({ query: z.string().trim().max(120).optional(), ...pageInput }),
  output: Page(TagAdmin),
});

export const tagsRename = defineContract({
  name: "tags.rename",
  summary:
    "Rename a tag. The old name stays as an alias that reaches the tag (old links and hashtags " +
    "typed with it keep working). Refused when the new name is another tag's name or alias. " +
    "Requires tag.manage.",
  kind: "write",
  input: z.object({ tagId: Id, name: TagInput }),
  output: TagAdmin,
});

export const tagsMerge = defineContract({
  name: "tags.merge",
  summary:
    "Merge a tag into another: its threads take the other tag, its name and aliases become " +
    "aliases of the other tag, and it is removed. Requires tag.manage.",
  kind: "write",
  input: z.object({ tagId: Id, intoTagId: Id }),
  output: TagAdmin,
});

export const tagsDelete = defineContract({
  name: "tags.delete",
  summary:
    "Delete a tag and take it off every thread. Hashtags already written stay as links to a " +
    "page that no longer exists. Requires tag.manage.",
  kind: "write",
  input: z.object({ tagId: Id }),
  output: Ok,
});
