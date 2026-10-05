import { GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { NotFoundError } from "../../errors";
import { getNodeAccess, getNodeTree } from "../permissions";
import { canonicalPath, canonicalUrl, requireBaseURL } from "./paths";

const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!,
  );
type Row = {
  id: number;
  node_id: number;
  title: string;
  excerpt: string;
  created_at: number;
  last_post_at: number;
  content_updated_at: number | null;
  username: string;
};

/** Public site or node feed. Never exposes content that a guest cannot view. */
export function atomFeed(
  ctx: Ctx,
  baseURL: string,
  siteName: string,
  nodeId?: number,
  limit = 50,
): string {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("Invalid feed limit");
  const access = getNodeAccess(ctx, GUEST);
  const node = nodeId == null ? undefined : getNodeTree(ctx).get(nodeId);
  if (nodeId != null && (!node || !access(nodeId).view)) throw new NotFoundError();
  const publicNodeIds =
    nodeId == null
      ? getNodeTree(ctx)
          .entries.filter((entry) => access(entry.id).view)
          .map((entry) => entry.id)
      : [];
  const rows =
    nodeId == null
      ? prepared(ctx, "seo.atomSite", () =>
          ctx.sqlite.prepare<Row, [string, number]>(
            "SELECT t.id,t.node_id,t.title,t.excerpt,t.created_at,t.last_post_at,t.content_updated_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.state='visible' AND t.node_id IN (SELECT value FROM json_each(?1)) ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
          ),
        ).all(JSON.stringify(publicNodeIds), limit)
      : prepared(ctx, "seo.atomNode", () =>
          ctx.sqlite.prepare<Row, [number, number]>(
            "SELECT t.id,t.node_id,t.title,t.excerpt,t.created_at,t.last_post_at,t.content_updated_at,u.username FROM threads t JOIN users u ON u.id=t.user_id WHERE t.state='visible' AND t.node_id=?1 ORDER BY t.last_post_at DESC,t.id DESC LIMIT ?2",
          ),
        ).all(nodeId, limit);
  const visible = rows;
  const feedUrl = new URL(
    node ? `${canonicalPath("node", node.id, node.title)}/feed.atom` : "/feed.atom",
    requireBaseURL(baseURL),
  ).href;
  const updated = visible.length
    ? new Date(
        Math.max(...visible.map((row) => row.content_updated_at ?? row.last_post_at)),
      ).toISOString()
    : new Date(0).toISOString();
  const entries = visible.map((row) => {
    const url = canonicalUrl(baseURL, "thread", row.id, row.title);
    return `<entry><id>${xml(url)}</id><title>${xml(row.title)}</title><link href="${xml(url)}"/><updated>${new Date(row.content_updated_at ?? row.last_post_at).toISOString()}</updated><published>${new Date(row.created_at).toISOString()}</published><author><name>${xml(row.username)}</name></author><summary>${xml(row.excerpt)}</summary></entry>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${xml(feedUrl)}</id><title>${xml(node?.title ?? siteName)}</title><updated>${updated}</updated><link href="${xml(feedUrl)}" rel="self"/>${entries.join("")}</feed>`;
}
