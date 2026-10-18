import { GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { postsList } from "../../contracts/forums";
import { NotFoundError } from "../../errors";
import { can, getNodeTree, type NodeTreeEntry, viewableNodeIds } from "../../permissions";
import { readGates } from "../forums/read-gates";
import { requireSiteOpenToGuests } from "../members/site-access";
import { readSiteSettings } from "../settings";
import { LLMS_FORUM_CAP, note, plain } from "./llms";
import { nodeSeo, threadSeo } from "./pages";
import { canonicalUrl, markdownUrl, requireBaseURL } from "./paths";
import { postMarkdown } from "./post-markdown";

/** Posts on one page of a thread's Markdown: as many as on the thread's own pages. */
export const MARKDOWN_POSTS_PER_PAGE = postsList.input.parse({ threadId: 1 }).limit;
/** The newest threads a forum's Markdown lists; the sitemap and the feed have the rest. */
export const MARKDOWN_FORUM_THREADS = 50;
/** The newest threads of each forum in /llms-full.txt. */
export const LLMS_FULL_FORUM_THREADS = 10;
/** The largest /llms-full.txt, in bytes: the forums that would go past it are left out. */
export const LLMS_FULL_CAP = 1_048_576;

/** The queries of these pages (the index test runs them as they are). */
export const MARKDOWN_SQL = {
  thread:
    "SELECT t.title,t.node_id,t.created_at,t.last_post_at,t.content_updated_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.id=?1",
  posts:
    "SELECT p.id,b.body_html,p.created_at,u.username FROM posts p JOIN post_bodies b ON b.post_id=p.id JOIN users u ON u.id=p.user_id WHERE p.thread_id=?1 AND p.position BETWEEN ?2 AND ?3 AND p.state='visible' ORDER BY p.position",
  positionBefore:
    "SELECT position FROM posts WHERE thread_id=?1 AND position<?2 AND state='visible' ORDER BY position DESC LIMIT 1",
  positionAfter:
    "SELECT position FROM posts WHERE thread_id=?1 AND position>?2 AND state='visible' ORDER BY position LIMIT 1",
  forumThreads:
    "SELECT t.id,t.title,t.excerpt,t.reply_count,t.last_post_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.node_id=?1 AND t.state='visible' AND t.first_post_id IS NOT NULL ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
} as const;

/** A Markdown page, or the address it now lives at (a renamed or merged thread). */
export type MarkdownPage = { redirect: string } | { markdown: string; canonical: string };

type ThreadRow = {
  title: string;
  node_id: number;
  created_at: number;
  last_post_at: number;
  content_updated_at: number | null;
  username: string;
};
type PostRow = { id: number; body_html: string; created_at: number; username: string };
type ListedThread = {
  id: number;
  title: string;
  excerpt: string;
  reply_count: number;
  last_post_at: number;
  username: string;
};

const iso = (ms: number) => new Date(ms).toISOString();

const withPage = (address: string, page: number) =>
  page === 1 ? address : `${address}?page=${page}`;

/** YAML front matter; a string is written as a JSON string, which YAML reads the same. */
function frontMatter(fields: Record<string, string | number>): string {
  const lines = Object.entries(fields).map(
    ([key, value]) => `${key}: ${typeof value === "number" ? value : JSON.stringify(value)}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * One page of a public thread as Markdown: the posts a guest reads on that page of the HTML
 * page, converted from their stored HTML. Only a thread the guest SEO read indexes has one: a
 * missing, hidden, moderated or deleted thread, one in a forum closed to guests and a page with
 * no visible post are not found. A stale slug or a merged thread answers with the address of the
 * current one.
 */
export function threadMarkdown(
  ctx: Ctx,
  baseURL: string,
  id: number,
  requestedPath: string,
  page: number,
): MarkdownPage {
  if (!Number.isSafeInteger(page) || page < 1) throw new NotFoundError();
  requireSiteOpenToGuests(ctx);
  const perPage = MARKDOWN_POSTS_PER_PAGE;
  const seo = threadSeo(ctx, GUEST, baseURL, id, requestedPath, { siteName: "" }, 1, perPage);
  if (seo.robots !== "index,follow") throw new NotFoundError();
  if (seo.redirect) return { redirect: withPage(markdownUrl(seo.canonical), page) };
  const thread = prepared(ctx, "seo.markdownThread", () =>
    ctx.sqlite.prepare<ThreadRow, [number]>(MARKDOWN_SQL.thread),
  ).get(id);
  const node = thread && getNodeTree(ctx).get(thread.node_id);
  if (!thread || !node) throw new NotFoundError();
  const posts = prepared(ctx, "seo.markdownPosts", () =>
    ctx.sqlite.prepare<PostRow, [number, number, number]>(MARKDOWN_SQL.posts),
  ).all(id, (page - 1) * perPage, page * perPage - 1);
  if (!posts.length) throw new NotFoundError();
  // Positions never change, so posts taken away leave gaps: a page of the thread can hold no
  // visible post while later ones do. The page links go to the nearest page that has one.
  const before = prepared(ctx, "seo.markdownPositionBefore", () =>
    ctx.sqlite.prepare<{ position: number }, [number, number]>(MARKDOWN_SQL.positionBefore),
  );
  const after = prepared(ctx, "seo.markdownPositionAfter", () =>
    ctx.sqlite.prepare<{ position: number }, [number, number]>(MARKDOWN_SQL.positionAfter),
  );
  const pageOf = (position: number) => Math.floor(position / perPage) + 1;
  const previous = page > 1 ? before.get(id, (page - 1) * perPage) : null;
  const next = after.get(id, page * perPage - 1);
  const pages = pageOf(before.get(id, Number.MAX_SAFE_INTEGER)?.position ?? 0);
  const origin = requireBaseURL(baseURL).origin;
  const canonical = withPage(seo.canonical, page);
  const forumUrl = markdownUrl(canonicalUrl(baseURL, "node", node.id, node.title));
  const parts = [
    `# ${plain(thread.title)}`,
    `In [${plain(node.title)}](${forumUrl}), started by ${plain(thread.username)} on ${iso(thread.created_at)}.${pages > 1 ? ` Page ${page} of ${pages}.` : ""}`,
  ];
  for (const post of posts) {
    // The body is a block quote: whatever block a post opens (a list, a fence, a heading) ends
    // with it, so the next post's heading and the page links stay the document's own.
    const body = postMarkdown(post.body_html, origin)
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
    const heading = `## ${plain(post.username)}, [${iso(post.created_at)}](${canonical}#post-${post.id})`;
    parts.push(body !== ">" ? `${heading}\n\n${body}` : heading);
  }
  const links = [];
  const pageAddress = markdownUrl(seo.canonical);
  if (previous) links.push(`[Previous page](${withPage(pageAddress, pageOf(previous.position))})`);
  if (next) links.push(`[Next page](${withPage(pageAddress, pageOf(next.position))})`);
  if (links.length) parts.push(`---\n\n${links.join(" · ")}`);
  const markdown = `${frontMatter({
    title: thread.title,
    url: canonical,
    forum: node.title,
    author: thread.username,
    published: iso(thread.created_at),
    updated: iso(thread.content_updated_at ?? thread.last_post_at),
    page,
    pages,
  })}${parts.join("\n\n")}\n`;
  return { markdown, canonical };
}

/**
 * What a forum's Markdown says under its title: its description, where it sits, the forums in
 * it a guest can see and, when guests may read its threads, its newest `limit` threads.
 */
function forumBody(ctx: Ctx, baseURL: string, node: NodeTreeEntry, limit: number): string {
  const tree = getNodeTree(ctx);
  const at = (entry: NodeTreeEntry) =>
    markdownUrl(canonicalUrl(baseURL, "node", entry.id, entry.title));
  const parts: string[] = [];
  if (node.description.trim()) parts.push(`> ${plain(node.description)}`);
  const parents = tree.ancestors(node.id);
  if (parents.length)
    parts.push(
      `Part of ${parents.map((entry) => `[${plain(entry.title)}](${at(entry)})`).join(" › ")}.`,
    );
  const children = tree.entries.filter(
    (entry) => entry.parentId === node.id && can(ctx, GUEST, "node.view", { nodeId: entry.id }),
  );
  if (children.length)
    parts.push(
      `## Forums\n\n${children
        .map((entry) => {
          const about = note(entry.description);
          return `- [${plain(entry.title)}](${at(entry)})${about ? `: ${about}` : ""}`;
        })
        .join("\n")}`,
    );
  const gates = readGates(ctx, GUEST);
  if (node.type === "forum" && gates.opensOthers(node.id) && gates.readsOthers(node.id)) {
    const threads = prepared(ctx, "seo.markdownForumThreads", () =>
      ctx.sqlite.prepare<ListedThread, [number, number]>(MARKDOWN_SQL.forumThreads),
    ).all(node.id, limit);
    if (threads.length)
      parts.push(
        `## Threads\n\nThe ${threads.length === limit ? `${limit} ` : ""}threads with the newest posts.\n\n${threads
          .map((thread) => {
            const url = markdownUrl(canonicalUrl(baseURL, "thread", thread.id, thread.title));
            const replies = `${thread.reply_count} ${thread.reply_count === 1 ? "reply" : "replies"}`;
            const excerpt = note(thread.excerpt);
            return `- [${plain(thread.title)}](${url}) by ${plain(thread.username)}, ${replies}, last post ${iso(thread.last_post_at)}${excerpt ? `: ${excerpt}` : ""}`;
          })
          .join("\n")}`,
      );
  }
  return parts.join("\n\n");
}

/**
 * A public forum or category as Markdown. Only a node guests may see has one (the SEO read
 * indexes exactly those); a stale slug answers with the current address.
 */
export function forumMarkdown(
  ctx: Ctx,
  baseURL: string,
  id: number,
  requestedPath: string,
): MarkdownPage {
  requireSiteOpenToGuests(ctx);
  const seo = nodeSeo(ctx, GUEST, baseURL, id, requestedPath, { siteName: "" });
  if (seo.robots !== "index,follow") throw new NotFoundError();
  if (seo.redirect) return { redirect: markdownUrl(seo.canonical) };
  const node = getNodeTree(ctx).get(id);
  if (!node) throw new NotFoundError();
  const body = forumBody(ctx, baseURL, node, MARKDOWN_FORUM_THREADS);
  const markdown = `${frontMatter({ title: node.title, url: seo.canonical })}# ${plain(node.title)}${body ? `\n\n${body}` : ""}\n`;
  return { markdown, canonical: seo.canonical };
}

/**
 * /llms-full.txt: the forums /llms.txt lists, in the order of the forum tree, each as its
 * Markdown says it with its newest `LLMS_FULL_FORUM_THREADS` threads. At most `LLMS_FULL_CAP`
 * bytes: the forums past it are left out and the file says so.
 */
export function llmsFullTxt(ctx: Ctx, baseURL: string): string {
  const origin = requireBaseURL(baseURL);
  requireSiteOpenToGuests(ctx);
  const settings = readSiteSettings(ctx);
  const siteName = plain(settings.siteName) || "Forum";
  const description = plain(settings.siteDescription);
  const at = (path: string) => new URL(path, origin).href;
  const head = [
    `# ${siteName}`,
    `> ${description || `${siteName} is a discussion forum.`}`,
    `The public forums listed in [llms.txt](${at("/llms.txt")}), each with the ${LLMS_FULL_FORUM_THREADS} threads with the newest posts. Every public forum and thread has a Markdown version at its address with \`.md\` added; a thread's holds its posts.`,
  ].join("\n\n");
  const cut = `---\n\nThe file stops here, at ${LLMS_FULL_CAP} bytes; the [sitemap](${at("/sitemap.xml")}) lists every public forum and thread.\n`;
  const tree = getNodeTree(ctx);
  const visible = new Set(viewableNodeIds(ctx, GUEST));
  const parts = [head];
  let size = Buffer.byteLength(head) + Buffer.byteLength(cut);
  let listed = 0;
  for (const entry of tree.entries) {
    if (entry.type !== "forum" || !visible.has(entry.id)) continue;
    if (listed++ >= LLMS_FORUM_CAP) break;
    const url = canonicalUrl(baseURL, "node", entry.id, entry.title);
    const body = forumBody(ctx, baseURL, entry, LLMS_FULL_FORUM_THREADS);
    const section = `---\n\n# ${plain(entry.title)}\n\n<${markdownUrl(url)}>${body ? `\n\n${body}` : ""}`;
    size += Buffer.byteLength(section) + 2;
    if (size > LLMS_FULL_CAP) return `${parts.join("\n\n")}\n\n${cut}`;
    parts.push(section);
  }
  return `${parts.join("\n\n")}\n`;
}
