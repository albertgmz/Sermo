import { type Actor, actorUserId } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { markPublic } from "../../operation";
import { viewableNodeIds } from "../../permissions";
import { requireSiteView } from "../members/site-access";

/** The most members a "following" feed walks: the ones the viewer followed most recently. */
export const FOLLOWED_CAP = 100;

export const viewerSql = {
  followedAmong:
    "SELECT followed_id FROM user_follows WHERE user_id = ?1 AND followed_id IN (SELECT value FROM json_each(?2))",
  followed: "SELECT followed_id FROM user_follows WHERE user_id = ?1 ORDER BY id DESC LIMIT ?2",
};

/** The forums (nodes) the viewer may open. */
export const visibleNodes = markPublic(
  "Resolves the node.view permission for the viewer.",
  function visibleNodes(ctx: Ctx, actor: Actor): Set<number> {
    // Whatever forums the viewer sees: the wall posts in the feed need the site open as well.
    requireSiteView(ctx, actor);
    return new Set(viewableNodeIds(ctx, actor));
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
