import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import {
  can,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  requestVersions,
  viewableNodeIds,
} from "../../permissions";

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
    return new Set(viewableNodeIds(ctx, actor));
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
    const now = ctx.now();
    const result = new Set<number>();
    for (const row of prepared(ctx, "feed.principals", () =>
      ctx.sqlite.prepare<PrincipalRow & { id: number; group_id: number }, [string]>(
        viewerSql.principals,
      ),
    ).all(JSON.stringify(ignored))) {
      const banned =
        !!row.banned_permanently || (row.banned_until !== null && row.banned_until > now);
      if (banned || can(ctx, memberActor(row.id, row.group_id, row, versions), "member.ignorable"))
        result.add(row.id);
    }
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

type State = "visible" | "moderated" | "deleted";

/**
 * Whether content in a given state is shown to the viewer: the rule of the per-forum listing.
 * Visible content needs only the forum; moderated content needs its author or
 * forum.viewModerated there; deleted content needs forum.viewDeleted there.
 */
function contentRule(ctx: Ctx, actor: Actor, nodes: Set<number>) {
  const permissions = permissionsOf(ctx, actor);
  const viewerId = actorUserId(actor);
  return (nodeId: number, state: State, ownerId: number): boolean =>
    nodes.has(nodeId) &&
    (state === "visible" ||
      (state === "moderated" &&
        (ownerId === viewerId || permissions.can("forum.viewModerated", { nodeId }))) ||
      (state === "deleted" && permissions.can("forum.viewDeleted", { nodeId })));
}

export const contentRuleFor = markPublic(
  "The rule itself decides per forum with node.view, forum.viewModerated and forum.viewDeleted.",
  contentRule,
);
