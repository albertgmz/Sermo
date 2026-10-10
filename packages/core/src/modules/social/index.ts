import * as z from "zod";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { SUPPORTED_LANGUAGES } from "../../contracts/settings";
import * as contracts from "../../contracts/social";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { type DomainEvent, publishEvent, registerEventSubscriber } from "../../events";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentVersions,
  getNodeTree,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  requirePermission,
} from "../../permissions";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";

type Thread = {
  id: number;
  node_id: number;
  user_id: number;
  title: string;
  state: string;
  last_post_at: number;
};
type Watch = {
  id: number;
  thread_id: number;
  node_id: number;
  mode: "threads" | "posts";
  email: number;
  created_at: number;
};
type Follow = {
  id: number;
  user_id: number;
  followed_id: number;
  ignored_id: number;
  created_at: number;
};
type Preferences = {
  watch_on_create: "none" | "watch" | "watch_email";
  watch_on_reply: "none" | "watch" | "watch_email";
  language: string | null;
  profile_view_privacy: "everyone" | "members" | "followed" | "self";
  profile_post_privacy: "members" | "followed" | "self";
};
const cursorSchema = z.tuple([z.number().int().positive()]);
const cursorId = (cursor?: string) =>
  cursor ? decodeCursor(cursor, cursorSchema)[0] : Number.MAX_SAFE_INTEGER;
function query<Row, Params extends (string | number | null)[]>(ctx: Ctx, key: string, sql: string) {
  return prepared(ctx, `social.${key}`, () => ctx.sqlite.prepare<Row, Params>(sql));
}
function userExists(ctx: Ctx, id: number): boolean {
  return !!query<{ id: number }, [number]>(
    ctx,
    "userExists",
    "SELECT id FROM users WHERE id = ?1",
  ).get(id);
}
function requireUser(ctx: Ctx, id: number): void {
  if (!userExists(ctx, id)) throw new NotFoundError();
}
function thread(ctx: Ctx, id: number): Thread {
  const row = query<Thread, [number]>(
    ctx,
    "thread",
    "SELECT id, node_id, user_id, title, state, last_post_at FROM threads WHERE id = ?1",
  ).get(id);
  if (!row) throw new NotFoundError();
  return row;
}
function visibleThread(
  ctx: Ctx,
  actor: Parameters<typeof requireAuthenticated>[0],
  row: Thread,
): boolean {
  if (!can(ctx, actor, "node.view", { nodeId: row.node_id })) return false;
  if (row.state === "visible") return true;
  if (row.state === "moderated")
    return (
      row.user_id === actorUserId(actor) ||
      can(ctx, actor, "forum.viewModerated", { nodeId: row.node_id })
    );
  return can(ctx, actor, "forum.viewDeleted", { nodeId: row.node_id });
}
function requireVisibleThread(
  ctx: Ctx,
  actor: Parameters<typeof requireAuthenticated>[0],
  id: number,
): Thread {
  const row = thread(ctx, id);
  if (!visibleThread(ctx, actor, row)) throw new NotFoundError();
  return row;
}
function requireForum(ctx: Ctx, actor: Parameters<typeof requireAuthenticated>[0], id: number) {
  const node = getNodeTree(ctx).get(id);
  if (!node) throw new NotFoundError();
  requirePermission(ctx, actor, "node.view", { nodeId: id }, { notFound: true });
  if (node.type !== "forum") throw new ValidationError("Categories cannot be watched.");
  return node;
}
function page<Row extends { id: number }>(rows: Row[], limit: number) {
  const selected = rows.slice(0, limit);
  return { selected, nextCursor: rows.length > limit ? encodeCursor([selected.at(-1)!.id]) : null };
}

export const threadsWatchOp = implement(contracts.threadsWatch, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  writeTx(ctx, () => {
    requireVisibleThread(ctx, actor, input.threadId);
    query(
      ctx,
      "watchThread",
      "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(thread_id, user_id) DO UPDATE SET email = excluded.email",
    ).run(user.userId, input.threadId, Number(input.email), ctx.now());
  });
  return { watching: true as const, email: input.email };
});
export const threadsUnwatchOp = implement(
  contracts.threadsUnwatch,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      query(
        ctx,
        "unwatchThread",
        "DELETE FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2",
      ).run(input.threadId, user.userId);
    });
    return { ok: true as const };
  },
  { public: "A signed-in member can remove only their own thread watch." },
);
export const nodesWatchOp = implement(contracts.nodesWatch, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  writeTx(ctx, () => {
    requireForum(ctx, actor, input.nodeId);
    query(
      ctx,
      "watchNode",
      "INSERT INTO node_watches (user_id, node_id, mode, email, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(node_id, user_id) DO UPDATE SET mode = excluded.mode, email = excluded.email",
    ).run(user.userId, input.nodeId, input.mode, Number(input.email), ctx.now());
  });
  return { watching: true as const, mode: input.mode, email: input.email };
});
export const nodesUnwatchOp = implement(
  contracts.nodesUnwatch,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      query(ctx, "unwatchNode", "DELETE FROM node_watches WHERE node_id = ?1 AND user_id = ?2").run(
        input.nodeId,
        user.userId,
      );
    });
    return { ok: true as const };
  },
  { public: "A signed-in member can remove only their own node watch." },
);

export const watchSql = {
  threads:
    "SELECT id, thread_id, email, created_at FROM thread_watches WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  nodes:
    "SELECT id, node_id, mode, email, created_at FROM node_watches WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  followers:
    "SELECT id, user_id, created_at FROM user_follows WHERE followed_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  following:
    "SELECT id, followed_id, created_at FROM user_follows WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
  ignored:
    "SELECT id, ignored_id, created_at FROM user_ignores WHERE user_id = ?1 AND id < ?2 ORDER BY id DESC LIMIT ?3",
} as const;
export const watchesListThreadsOp = implement(contracts.watchesListThreads, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { selected, nextCursor } = page(
    query<Watch, [number, number, number]>(ctx, "listThreads", watchSql.threads).all(
      user.userId,
      cursorId(input.cursor),
      input.limit + 1,
    ),
    input.limit,
  );
  const details = selected.length
    ? query<Thread, [string]>(
        ctx,
        "threadBatch",
        "SELECT id, node_id, user_id, title, state, last_post_at FROM threads WHERE id IN (SELECT value FROM json_each(?1))",
      ).all(JSON.stringify(selected.map((r) => r.thread_id)))
    : [];
  const byId = new Map(details.map((r) => [r.id, r]));
  return {
    items: selected.flatMap((r) => {
      const t = byId.get(r.thread_id);
      return t && visibleThread(ctx, actor, t)
        ? [
            {
              threadId: t.id,
              title: t.title,
              nodeId: t.node_id,
              email: !!r.email,
              lastPostAt: iso(t.last_post_at),
              createdAt: iso(r.created_at),
            },
          ]
        : [];
    }),
    nextCursor,
  };
});
export const watchesListNodesOp = implement(contracts.watchesListNodes, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  const { selected, nextCursor } = page(
    query<Watch, [number, number, number]>(ctx, "listNodes", watchSql.nodes).all(
      user.userId,
      cursorId(input.cursor),
      input.limit + 1,
    ),
    input.limit,
  );
  const tree = getNodeTree(ctx);
  return {
    items: selected.flatMap((r) => {
      const node = tree.get(r.node_id);
      return node?.type === "forum" && can(ctx, actor, "node.view", { nodeId: node.id })
        ? [
            {
              nodeId: node.id,
              title: node.title,
              mode: r.mode,
              email: !!r.email,
              createdAt: iso(r.created_at),
            },
          ]
        : [];
    }),
    nextCursor,
  };
});

export const usersFollowOp = implement(contracts.usersFollow, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.follow");
  if (user.userId === input.userId) throw new ValidationError("You cannot follow yourself.");
  const followerCount = writeTx(ctx, () => {
    requireUser(ctx, input.userId);
    const added = query(
      ctx,
      "follow",
      "INSERT OR IGNORE INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, ?3)",
    ).run(user.userId, input.userId, ctx.now()).changes;
    if (added) {
      query(
        ctx,
        "incrementFollower",
        "UPDATE users SET follower_count = follower_count + 1 WHERE id = ?1",
      ).run(input.userId);
      query(
        ctx,
        "incrementFollowing",
        "UPDATE users SET following_count = following_count + 1 WHERE id = ?1",
      ).run(user.userId);
      publishEvent(ctx, {
        type: "member.followed",
        targetType: "user",
        targetId: input.userId,
        payload: { followerId: user.userId },
      });
    }
    return query<{ follower_count: number }, [number]>(
      ctx,
      "followerCount",
      "SELECT follower_count FROM users WHERE id = ?1",
    ).get(input.userId)!.follower_count;
  });
  return { following: true as const, followerCount };
});
export const usersUnfollowOp = implement(
  contracts.usersUnfollow,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      const removed = query(
        ctx,
        "unfollow",
        "DELETE FROM user_follows WHERE user_id = ?1 AND followed_id = ?2",
      ).run(user.userId, input.userId).changes;
      if (removed) {
        query(
          ctx,
          "decrementFollower",
          "UPDATE users SET follower_count = follower_count - 1 WHERE id = ?1",
        ).run(input.userId);
        query(
          ctx,
          "decrementFollowing",
          "UPDATE users SET following_count = following_count - 1 WHERE id = ?1",
        ).run(user.userId);
      }
    });
    return { ok: true as const };
  },
  { public: "A signed-in member can remove only their own follow row." },
);
function followList(
  ctx: Ctx,
  actor: Parameters<typeof requireAuthenticated>[0],
  userId: number,
  cursor: string | undefined,
  limit: number,
  mode: "followers" | "following",
) {
  requirePermission(ctx, actor, "profile.view");
  requireUser(ctx, userId);
  const { selected, nextCursor } = page(
    query<Follow, [number, number, number]>(ctx, mode, watchSql[mode]).all(
      userId,
      cursorId(cursor),
      limit + 1,
    ),
    limit,
  );
  const summary = loadUserSummaries(
    ctx,
    selected.map((r) => (mode === "followers" ? r.user_id : r.followed_id)),
  );
  return {
    items: selected.map((r) => ({
      user: summary(mode === "followers" ? r.user_id : r.followed_id),
      followedAt: iso(r.created_at),
    })),
    nextCursor,
  };
}
export const usersListFollowersOp = implement(contracts.usersListFollowers, (ctx, actor, input) =>
  followList(ctx, actor, input.userId, input.cursor, input.limit, "followers"),
);
export const usersListFollowingOp = implement(contracts.usersListFollowing, (ctx, actor, input) =>
  followList(ctx, actor, input.userId, input.cursor, input.limit, "following"),
);

export const usersIgnoreOp = implement(contracts.usersIgnore, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "member.ignore");
  if (user.userId === input.userId) throw new ValidationError("You cannot ignore yourself.");
  writeTx(ctx, () => {
    const target = query<PrincipalRow & { id: number; group_id: number }, [number]>(
      ctx,
      "ignoreTarget",
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ).get(input.userId);
    if (!target) throw new NotFoundError();
    const banned =
      !!target.banned_permanently ||
      (target.banned_until !== null && target.banned_until > ctx.now());
    if (
      !banned &&
      !can(
        ctx,
        memberActor(target.id, target.group_id, target, requestVersions(ctx, actor)),
        "member.ignorable",
      )
    )
      throw new ForbiddenError();
    query(
      ctx,
      "ignore",
      "INSERT OR IGNORE INTO user_ignores (user_id, ignored_id, created_at) VALUES (?1, ?2, ?3)",
    ).run(user.userId, input.userId, ctx.now());
  });
  return { ok: true as const };
});
export const usersUnignoreOp = implement(
  contracts.usersUnignore,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    writeTx(ctx, () => {
      query(ctx, "unignore", "DELETE FROM user_ignores WHERE user_id = ?1 AND ignored_id = ?2").run(
        user.userId,
        input.userId,
      );
    });
    return { ok: true as const };
  },
  { public: "A signed-in member can remove only their own ignore row." },
);
export const usersListIgnoredOp = implement(
  contracts.usersListIgnored,
  (ctx, actor, input) => {
    const user = requireAuthenticated(actor);
    const { selected, nextCursor } = page(
      query<Follow, [number, number, number]>(ctx, "ignored", watchSql.ignored).all(
        user.userId,
        cursorId(input.cursor),
        input.limit + 1,
      ),
      input.limit,
    );
    const summary = loadUserSummaries(
      ctx,
      selected.map((r) => r.ignored_id),
    );
    return {
      items: selected.map((r) => ({ user: summary(r.ignored_id), followedAt: iso(r.created_at) })),
      nextCursor,
    };
  },
  { public: "A signed-in member can list only their own ignored members." },
);

function readPreferences(ctx: Ctx, userId: number) {
  const row = query<Preferences, [number]>(
    ctx,
    "preferences",
    "SELECT watch_on_create, watch_on_reply, language, profile_view_privacy, profile_post_privacy FROM users WHERE id = ?1",
  ).get(userId)!;
  return {
    watchOnCreate: row.watch_on_create,
    watchOnReply: row.watch_on_reply,
    language: row.language,
    profileViewPrivacy: row.profile_view_privacy,
    profilePostPrivacy: row.profile_post_privacy,
  };
}
export const preferencesGetOp = implement(contracts.preferencesGet, (ctx, actor) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  return readPreferences(ctx, user.userId);
});
export const preferencesUpdateOp = implement(contracts.preferencesUpdate, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  if (
    input.language != null &&
    !SUPPORTED_LANGUAGES.includes(input.language as (typeof SUPPORTED_LANGUAGES)[number])
  )
    throw new ValidationError("Unsupported language.");
  writeTx(ctx, () => {
    const current = readPreferences(ctx, user.userId);
    query(
      ctx,
      "updatePreferences",
      "UPDATE users SET watch_on_create = ?1, watch_on_reply = ?2, language = ?3, profile_view_privacy = ?4, profile_post_privacy = ?5 WHERE id = ?6",
    ).run(
      input.watchOnCreate ?? current.watchOnCreate,
      input.watchOnReply ?? current.watchOnReply,
      input.language === undefined ? current.language : input.language,
      input.profileViewPrivacy ?? current.profileViewPrivacy,
      input.profilePostPrivacy ?? current.profilePostPrivacy,
      user.userId,
    );
  });
  return readPreferences(ctx, user.userId);
});

function autoWatch(ctx: Ctx, event: DomainEvent): void {
  if (
    event.type !== "content.created" ||
    (event.targetType !== "thread" && event.targetType !== "post")
  )
    return;
  writeTx(ctx, () => {
    const row =
      event.targetType === "thread"
        ? query<{ thread_id: number; user_id: number }, [number]>(
            ctx,
            "eventThread",
            "SELECT id AS thread_id, user_id FROM threads WHERE id = ?1",
          ).get(event.targetId)
        : query<{ thread_id: number; user_id: number; position: number }, [number]>(
            ctx,
            "eventPost",
            "SELECT thread_id, user_id, position FROM posts WHERE id = ?1",
          ).get(event.targetId);
    if (!row || ("position" in row && row.position === 0)) return;
    const threadRow = query<Thread, [number]>(
      ctx,
      "thread",
      "SELECT id, node_id, user_id, title, state, last_post_at FROM threads WHERE id = ?1",
    ).get(row.thread_id);
    if (!threadRow) return;
    const author = query<PrincipalRow & { group_id: number }, [number]>(
      ctx,
      "eventAuthor",
      `SELECT u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`,
    ).get(row.user_id);
    if (!author) return;
    const actor = memberActor(row.user_id, author.group_id, author, currentVersions(ctx));
    if (!visibleThread(ctx, actor, threadRow)) return;
    const preference = query<{ mode: string }, [number]>(
      ctx,
      `eventPreference.${event.targetType}`,
      `SELECT ${event.targetType === "thread" ? "watch_on_create" : "watch_on_reply"} AS mode FROM users WHERE id = ?1`,
    ).get(row.user_id)?.mode;
    if (!preference || preference === "none") return;
    query(
      ctx,
      "autoWatch",
      "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(thread_id, user_id) DO UPDATE SET email = MAX(thread_watches.email, excluded.email)",
    ).run(row.user_id, row.thread_id, Number(preference === "watch_email"), ctx.now());
  });
}
export function registerSocialJobs(ctx: Ctx): void {
  registerEventSubscriber(ctx, "watches", (event) => autoWatch(ctx, event));
}
export const operations = [
  threadsWatchOp,
  threadsUnwatchOp,
  nodesWatchOp,
  nodesUnwatchOp,
  watchesListThreadsOp,
  watchesListNodesOp,
  usersFollowOp,
  usersUnfollowOp,
  usersListFollowersOp,
  usersListFollowingOp,
  usersIgnoreOp,
  usersUnignoreOp,
  usersListIgnoredOp,
  preferencesGetOp,
  preferencesUpdateOp,
];
