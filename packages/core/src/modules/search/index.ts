import * as z from "zod";
import { prepared } from "../../context";
import { searchQuery } from "../../contracts/search";
import { NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";
import { getNodeTree, viewableNodeIds } from "../permissions";

const CANDIDATE_CAP = 1000;
const BATCH_SIZE = 100;
export const searchSql = {
  candidates:
    "SELECT rowid FROM search_fts WHERE search_fts MATCH ?1 AND rowid < ?2 ORDER BY rowid DESC LIMIT ?3",
  details:
    "SELECT p.id, p.position, p.created_at, p.user_id, p.state AS post_state, " +
    "t.id AS thread_id, t.title, t.node_id, t.state AS thread_state " +
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
  thread_state: string;
};

function excerpt(source: string): string {
  return source
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~#>!|\\[\](){}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export const searchQueryOp = implement(searchQuery, (ctx, actor, input) => {
  const words = input.q.match(/[\p{L}\p{N}]+/gu)?.slice(0, 10) ?? [];
  if (words.length === 0) throw new ValidationError("Search query needs a word.");
  const expression = words.map((word) => `"${word}"`).join(" AND ");
  const match = input.titlesOnly ? `title : (${expression})` : expression;
  const viewable = new Set(viewableNodeIds(ctx, actor));
  if (input.nodeId !== undefined && !viewable.has(input.nodeId)) throw new NotFoundError();
  const nodes =
    input.nodeId === undefined
      ? viewable
      : new Set(
          getNodeTree(ctx)
            .subtreeIds(input.nodeId)
            .filter((id) => viewable.has(id)),
        );
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
  while (examined < CANDIDATE_CAP && accepted.length < input.limit) {
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
        nodes.has(detail.node_id)
      )
        accepted.push(detail);
      if (accepted.length === input.limit) break;
    }
    if (accepted.length === input.limit || examined === CANDIDATE_CAP) {
      hasMore =
        batch.some((row) => row.rowid < cursor) || Boolean(candidates.get(match, cursor, 1));
      break;
    }
    if (batch.length <= rows.length) break;
  }
  const users = loadUserSummaries(
    ctx,
    accepted.map((row) => row.user_id),
  );
  const bodies = prepared(ctx, "search.bodies", () =>
    ctx.sqlite.prepare<{ post_id: number; body_source: string }, [string]>(searchSql.bodies),
  ).all(JSON.stringify(accepted.map((row) => row.id)));
  const source = new Map(bodies.map((row) => [row.post_id, row.body_source]));
  return {
    items: accepted.map((row) => ({
      post: {
        id: row.id,
        position: row.position,
        createdAt: iso(row.created_at),
        author: users(row.user_id),
        excerpt: excerpt(source.get(row.id) ?? ""),
      },
      thread: { id: row.thread_id, title: row.title, nodeId: row.node_id },
    })),
    nextCursor: hasMore ? encodeCursor([cursor]) : null,
  };
});

export const operations = [searchQueryOp];
