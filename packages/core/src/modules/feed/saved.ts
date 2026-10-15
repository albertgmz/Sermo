import type * as z from "zod";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  FEED_FILTER_LIMIT,
  FEED_HIDDEN_LIMIT,
  FeedFilter,
  feedDeleteFilter,
  feedHideForum,
  feedOptions,
  feedSaveFilter,
  type SavedFeedFilter,
} from "../../contracts/feed";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError } from "../../errors";
import { implement } from "../../operation";
import { currentActor, viewableNodeIds } from "../../permissions";
import { iso } from "../../time";
import { requireSiteView } from "../members/site-access";
import { readSiteSettings } from "../settings";
import { hiddenForumIds } from "./filter";

type Saved = z.infer<typeof SavedFeedFilter>;

interface FilterRow {
  id: number;
  name: string;
  scope: Saved["scope"];
  filter: string;
  created_at: number;
}

export const savedSql = {
  list: "SELECT id, name, scope, filter, created_at FROM feed_filters WHERE user_id = ?1 ORDER BY id",
  byName: "SELECT id FROM feed_filters WHERE user_id = ?1 AND name_key = ?2",
  count: "SELECT count(*) AS n FROM feed_filters WHERE user_id = ?1",
  insert:
    "INSERT INTO feed_filters (user_id, name, name_key, scope, filter, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id, name, scope, filter, created_at",
  replace:
    "UPDATE feed_filters SET name = ?3, scope = ?4, filter = ?5 WHERE id = ?1 AND user_id = ?2 RETURNING id, name, scope, filter, created_at",
  delete: "DELETE FROM feed_filters WHERE id = ?1 AND user_id = ?2",
  hiddenCount: "SELECT count(*) AS n FROM feed_hidden_nodes WHERE user_id = ?1",
  hide: "INSERT OR IGNORE INTO feed_hidden_nodes (user_id, node_id, created_at) VALUES (?1, ?2, ?3)",
  show: "DELETE FROM feed_hidden_nodes WHERE user_id = ?1 AND node_id = ?2",
};

const nameKey = (name: string) => name.toLowerCase();

/** What a filter keeps: only the fields that are on, so the stored JSON is the same for the same filter. */
function compact(filter: z.infer<typeof FeedFilter>): z.infer<typeof FeedFilter> {
  const kept: z.infer<typeof FeedFilter> = {};
  if (filter.forumIds && filter.forumIds.length > 0) kept.forumIds = [...new Set(filter.forumIds)];
  if (filter.prefixId !== undefined) kept.prefixId = filter.prefixId;
  if (filter.type !== undefined) kept.type = filter.type;
  if (filter.tag !== undefined) kept.tag = filter.tag;
  if (filter.watched) kept.watched = true;
  if (filter.unread) kept.unread = true;
  return kept;
}

const savedValue = (row: FilterRow): Saved => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  filter: FeedFilter.parse(JSON.parse(row.filter)),
  createdAt: iso(row.created_at),
});

export const feedOptionsOp = implement(feedOptions, (ctx, actor) => {
  requireSiteView(ctx, actor);
  const userId = actorUserId(actor);
  return {
    excludedForumIds: readSiteSettings(ctx).feedExcludedForumIds,
    hiddenForumIds: hiddenForumIds(ctx, userId),
    filters:
      userId === null
        ? []
        : prepared(ctx, "feed.savedList", () =>
            ctx.sqlite.prepare<FilterRow, [number]>(savedSql.list),
          )
            .all(userId)
            .map(savedValue),
    filterLimit: FEED_FILTER_LIMIT,
  };
});

export const feedSaveFilterOp = implement(feedSaveFilter, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  requireAuthenticated(actor);
  const filter = JSON.stringify(compact(input.filter));
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireSiteView(ctx, current);
    const { userId } = requireAuthenticated(current);
    const key = nameKey(input.name);
    const same = prepared(ctx, "feed.savedByName", () =>
      ctx.sqlite.prepare<{ id: number }, [number, string]>(savedSql.byName),
    ).get(userId, key);
    if (same) {
      return savedValue(
        prepared(ctx, "feed.savedReplace", () =>
          ctx.sqlite.prepare<FilterRow, [number, number, string, string, string]>(savedSql.replace),
        ).get(same.id, userId, input.name, input.scope, filter)!,
      );
    }
    const held = prepared(ctx, "feed.savedCount", () =>
      ctx.sqlite.prepare<{ n: number }, [number]>(savedSql.count),
    ).get(userId)!.n;
    if (held >= FEED_FILTER_LIMIT)
      throw new ConflictError(
        `You can keep ${FEED_FILTER_LIMIT} saved filters: delete one to save another.`,
      );
    return savedValue(
      prepared(ctx, "feed.savedInsert", () =>
        ctx.sqlite.prepare<FilterRow, [number, string, string, string, string, number]>(
          savedSql.insert,
        ),
      ).get(userId, input.name, key, input.scope, filter, ctx.now())!,
    );
  });
});

export const feedDeleteFilterOp = implement(feedDeleteFilter, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  requireAuthenticated(actor);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireSiteView(ctx, current);
    const { userId } = requireAuthenticated(current);
    const removed = prepared(ctx, "feed.savedDelete", () =>
      ctx.sqlite.prepare<unknown, [number, number]>(savedSql.delete),
    ).run(input.filterId, userId);
    if (removed.changes === 0) throw new NotFoundError();
    return { deleted: true as const };
  });
});

/** Whether a forum is hidden from the member's feed is one row; hiding needs a forum they can see. */
export const feedHideForumOp = implement(feedHideForum, (ctx, actor, input) => {
  requireSiteView(ctx, actor);
  requireAuthenticated(actor);
  const sees = (ctxNow: Ctx, who: typeof actor) =>
    new Set(viewableNodeIds(ctxNow, who)).has(input.nodeId);
  if (input.hidden && !sees(ctx, actor)) throw new NotFoundError();
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const { userId } = requireAuthenticated(current);
    if (!input.hidden) {
      prepared(ctx, "feed.show", () =>
        ctx.sqlite.prepare<unknown, [number, number]>(savedSql.show),
      ).run(userId, input.nodeId);
      return { hidden: false };
    }
    if (!sees(ctx, current)) throw new NotFoundError();
    const held = prepared(ctx, "feed.hiddenCount", () =>
      ctx.sqlite.prepare<{ n: number }, [number]>(savedSql.hiddenCount),
    ).get(userId)!.n;
    const added = prepared(ctx, "feed.hide", () =>
      ctx.sqlite.prepare<unknown, [number, number, number]>(savedSql.hide),
    );
    if (held >= FEED_HIDDEN_LIMIT) {
      // Hiding what is already hidden is not a new row, and is fine at the limit.
      if (!hiddenForumIds(ctx, userId).includes(input.nodeId))
        throw new ConflictError(`You can hide ${FEED_HIDDEN_LIMIT} forums: show one again first.`);
      return { hidden: true };
    }
    added.run(userId, input.nodeId, ctx.now());
    return { hidden: true };
  });
});
