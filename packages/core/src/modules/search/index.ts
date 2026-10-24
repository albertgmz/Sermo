import * as z from "zod";
import { BB_SPOILER_MARK, maskBbCode } from "../../bbcode/mask";
import { prepared } from "../../context";
import { SEARCH_PAGES_MAX, searchQuery } from "../../contracts/search";
import { NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { getNodeTree, requirePermission, viewableNodeIds } from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { threadPresenter } from "../forums/presentation";
import { readGates } from "../forums/read-gates";
import { requireSiteView } from "../members/site-access";

const CANDIDATE_CAP = 1000;
const BATCH_SIZE = 100;
export const searchSql = {
  candidates:
    "SELECT rowid FROM search_fts WHERE search_fts MATCH ?1 AND rowid < ?2 ORDER BY rowid DESC LIMIT ?3",
  details:
    // A merge stores position p as -(p + 1) while it renumbers; results return the real position.
    "SELECT p.id, CASE WHEN p.position < 0 THEN -p.position - 1 ELSE p.position END AS position, p.created_at, p.user_id, p.state AS post_state, " +
    "t.id AS thread_id, t.title, t.node_id, t.prefix_id, t.state AS thread_state, t.user_id AS thread_user_id, t.first_post_id " +
    "FROM posts p JOIN threads t ON t.id = p.thread_id " +
    "WHERE p.id IN (SELECT value FROM json_each(?1))",
  bodies:
    "SELECT post_id, body_source FROM post_bodies WHERE post_id IN (SELECT value FROM json_each(?1))",
};
type Detail = {
  id: number;
  position: number;
  created_at: number;
  user_id: number;
  post_state: string;
  thread_id: number;
  title: string;
  node_id: number;
  prefix_id: number | null;
  thread_state: string;
  thread_user_id: number;
  first_post_id: number | null;
};

/** The start of a post's text; a spoiler leaves nothing, as in XenForo's search results. */
function excerpt(source: string): string {
  const plain = maskBbCode(source).replaceAll(BB_SPOILER_MARK, " ").replace(/\s+/g, " ").trim();
  return Array.from(plain).slice(0, 200).join("");
}

export const searchQueryOp = implement(searchQuery, (ctx, actor, input) => {
  requirePermission(ctx, actor, "search.use");
  requireSiteView(ctx, actor);
  const words = input.q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 10) ?? [];
  if (words.length === 0) throw new ValidationError("Search query needs a word.");
  const expression = words.map((word) => `"${word}"`).join(" AND ");
  const match = input.titlesOnly ? `title : (${expression})` : expression;
  const viewable = new Set(viewableNodeIds(ctx, actor));
  const gates = readGates(ctx, actor);
  // Where only titles are open, the opening post stands for its thread in a search by title.
  const titleOnly = (detail: Detail) =>
    input.titlesOnly &&
    detail.id === detail.first_post_id &&
    !gates.reads(detail.node_id, detail.user_id);
  if (input.nodeId !== undefined && !viewable.has(input.nodeId)) throw new NotFoundError();
  const nodes =
    input.nodeId === undefined
      ? viewable
      : new Set(
          getNodeTree(ctx)
            .subtreeIds(input.nodeId)
            .filter((id) => viewable.has(id)),
        );
  // A numbered page is cut from one walk that keeps the newest `SEARCH_PAGES_MAX` results (one
  // more, to know whether any lie beyond them); a cursor walk keeps one page.
  const numbered = input.page !== undefined && !input.cursor;
  const want = numbered ? SEARCH_PAGES_MAX + 1 : input.limit;
  let cursor = input.cursor
    ? decodeCursor(input.cursor, z.tuple([z.number().int().positive()]))[0]
    : Number.MAX_SAFE_INTEGER;
  let examined = 0;
  let hasMore = false;
  const accepted: Detail[] = [];
  const candidates = prepared(ctx, "search.candidates", () =>
    ctx.sqlite.prepare<{ rowid: number }, [string, number, number]>(searchSql.candidates),
  );
  const details = prepared(ctx, "search.details", () =>
    ctx.sqlite.prepare<Detail, [string]>(searchSql.details),
  );
  while (examined < CANDIDATE_CAP && accepted.length < want) {
    const remaining = CANDIDATE_CAP - examined;
    const batch = candidates.all(match, cursor, Math.min(BATCH_SIZE, remaining) + 1);
    if (batch.length === 0) break;
    const rows = batch.slice(0, Math.min(BATCH_SIZE, remaining));
    const byId = new Map(
      details.all(JSON.stringify(rows.map((row) => row.rowid))).map((row) => [row.id, row]),
    );
    for (const row of rows) {
      cursor = row.rowid;
      examined++;
      const detail = byId.get(row.rowid);
      if (
        detail?.post_state === "visible" &&
        detail.thread_state === "visible" &&
        nodes.has(detail.node_id) &&
        gates.opens(detail.node_id, detail.thread_user_id) &&
        (gates.reads(detail.node_id, detail.user_id) || titleOnly(detail)) &&
        (input.authorId === undefined || detail.user_id === input.authorId) &&
        (input.prefixId === undefined || detail.prefix_id === input.prefixId)
      )
        accepted.push(detail);
      if (accepted.length === want) break;
    }
    if (accepted.length === want || examined === CANDIDATE_CAP) {
      hasMore =
        batch.some((row) => row.rowid < cursor) || Boolean(candidates.get(match, cursor, 1));
      break;
    }
    if (batch.length <= rows.length) break;
  }
  const total = numbered ? Math.min(accepted.length, SEARCH_PAGES_MAX) : null;
  const from = numbered ? (input.page! - 1) * input.limit : 0;
  const shown = numbered ? accepted.slice(from, Math.min(from + input.limit, total!)) : accepted;
  const users = loadUserSummaries(
    ctx,
    shown.map((row) => row.user_id),
  );
  const bodies = prepared(ctx, "search.bodies", () =>
    ctx.sqlite.prepare<{ post_id: number; body_source: string }, [string]>(searchSql.bodies),
  ).all(JSON.stringify(shown.map((row) => row.id)));
  const source = new Map(bodies.map((row) => [row.post_id, row.body_source]));
  const present = threadPresenter(ctx);
  const last = shown.at(-1);
  return {
    items: shown.map((row) => ({
      post: {
        id: row.id,
        position: row.position,
        createdAt: iso(row.created_at),
        author: users(row.user_id),
        excerpt: gates.reads(row.node_id, row.user_id) ? excerpt(source.get(row.id) ?? "") : "",
      },
      thread: {
        id: row.thread_id,
        title: row.title,
        nodeId: row.node_id,
        node: present.node(row.node_id),
        prefix: present.prefix(row.prefix_id),
      },
    })),
    // A numbered page goes on from its last result while any result follows it, kept or not.
    nextCursor: numbered
      ? last && (from + input.limit < accepted.length || hasMore)
        ? encodeCursor([last.id])
        : null
      : hasMore
        ? encodeCursor([cursor])
        : null,
    total,
  };
});

export const operations = [searchQueryOp];
