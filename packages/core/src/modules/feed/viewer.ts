import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import {
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  viewableNodeIds,
} from "../../permissions";
import { requireSiteView } from "../members/site-access";
import { memberIgnorable } from "../social";

/** The most members a "following" feed walks: the ones the viewer followed most recently. */
export const FOLLOWED_CAP = 100;

export const viewerSql = {
  ignored:
    "SELECT ignored_id FROM user_ignores WHERE user_id = ?1 AND ignored_id IN (SELECT value FROM json_each(?2))",
  principals: `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id IN (SELECT value FROM json_each(?1))`,
  followedAmong:
    "SELECT followed_id FROM user_follows WHERE user_id = ?1 AND followed_id IN (SELECT value FROM json_each(?2))",
  followed: "SELECT followed_id FROM user_follows WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2",
};

/** The forums (nodes) the viewer may open. */
export const visibleNodes = markPublic(
  "Resolves the node.view permission for the viewer.",
  function visibleNodes(ctx: Ctx, actor: Actor): Set<number> {
    const nodes = viewableNodeIds(ctx, actor);
    // A viewer who sees no forum (a banned member) has nothing for the site rule to hide.
    if (nodes.length > 0) requireSiteView(ctx, actor);
    return new Set(nodes);
  },
);

/**
 * Authors, among `ids`, whose content the viewer has chosen not to see. An ignore applies only
 * while the author can be ignored: a member who has since joined staff (or lost the permission)
 * is shown again, as everywhere else an ignore is applied. One query for the ignore rows, and
 * one more only when the page holds an ignored author.
 */
export const ignoredAmong = markPublic(
  "Filters by the viewer's own ignore list; reveals nothing about other members.",
  function ignoredAmong(ctx: Ctx, actor: Actor, ids: Iterable<number>): Set<number> {
    const viewerId = actorUserId(actor);
    const unique = [...new Set(ids)].filter((id) => id !== viewerId);
    if (viewerId === null || unique.length === 0) return new Set();
    const ignored = prepared(ctx, "feed.ignored", () =>
      ctx.sqlite.prepare<{ ignored_id: number }, [number, string]>(viewerSql.ignored),
    )
      .all(viewerId, JSON.stringify(unique))
      .map((row) => row.ignored_id);
    if (ignored.length === 0) return new Set();
    const versions = requestVersions(ctx, actor);
    const result = new Set<number>();
    for (const row of prepared(ctx, "feed.principals", () =>
      ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [string]>(
        viewerSql.principals,
      ),
    ).all(JSON.stringify(ignored)))
      if (memberIgnorable(ctx, row, versions)) result.add(row.id);
    return result;
  },
);

/** Which of `ids` the viewer follows (empty for guests). */
export const followedAmong = markPublic(
  "Reads the viewer's own follow list.",
  function followedAmong(ctx: Ctx, actor: Actor, ids: Iterable<number>): Set<number> {
    const viewerId = actorUserId(actor);
    const unique = [...new Set(ids)];
    if (viewerId === null || unique.length === 0) return new Set();
    return new Set(
      prepared(ctx, "feed.followedAmong", () =>
        ctx.sqlite.prepare<{ followed_id: number }, [number, string]>(viewerSql.followedAmong),
      )
        .all(viewerId, JSON.stringify(unique))
        .map((row) => row.followed_id),
    );
  },
);

/** The members the viewer followed most recently, at most FOLLOWED_CAP. */
export const followedAuthors = markPublic(
  "Reads the viewer's own follow list.",
  function followedAuthors(ctx: Ctx, actor: Actor): number[] {
    const viewerId = actorUserId(actor);
    if (viewerId === null) return [];
    return prepared(ctx, "feed.followed", () =>
      ctx.sqlite.prepare<{ followed_id: number }, [number, number]>(viewerSql.followed),
    )
      .all(viewerId, FOLLOWED_CAP)
      .map((row) => row.followed_id);
  },
);
