import { type Ctx, prepared } from "../../context";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { purgeContent } from "../purge/purge";

/**
 * What a member who closes their own account leaves behind. Their threads, posts, writing on other
 * members' walls and conversation messages stay, and belong from then on to the reserved guest
 * account with no name kept (shown as "Guest" / "Invitado"). The wall of their own profile goes
 * with the profile, and the profile itself answers not found. Everything else the account held
 * (ledger, warnings, logs, reactions, follows) is `eraseMember`'s and stays as that leaves it.
 *
 * The move runs as a background job, one short transaction per chunk of rows: an account with
 * tens of thousands of posts must not stall the site. Each chunk finds what is left in the
 * database (nothing is carried between chunks), so a stopped job, a second run and a run over an
 * account that is already done are all safe. A server start looks for self-deleted accounts that
 * still hold content (deleted before this existed, or interrupted) and queues them.
 *
 * Only an account the member deleted themselves is touched; an administrator's erasure
 * (`users.adminErase`) keeps its content under the erased name.
 */
export const KEEP_CONTENT_JOB = "members.keepContent";
/** Rows moved per transaction. */
export const KEEP_CONTENT_CHUNK = 200;
/** Low priority: the next chunk waits for a later turn of the job worker. */
const PAUSE_MS = 200;

const jobKey = (userId: number) => `${KEEP_CONTENT_JOB}.${userId}`;

const OWN_CONTENT = [
  "SELECT 1 FROM threads WHERE user_id = u.id",
  "SELECT 1 FROM posts WHERE user_id = u.id",
  "SELECT 1 FROM profile_posts WHERE user_id = u.id",
  "SELECT 1 FROM profile_post_comments WHERE user_id = u.id",
  "SELECT 1 FROM conversation_messages WHERE user_id = u.id",
  "SELECT 1 FROM profile_posts WHERE profile_user_id = u.id",
]
  .map((select) => `EXISTS (${select})`)
  .join(" OR ");

export const keepContentSql = {
  // The erased accounts the member closed themselves (the log entry names them as its own actor)
  // that are not done: a profile still open, or content still theirs. Read once at a server start,
  // through `users_erased`, which holds only erased accounts.
  unfinished: `SELECT u.id FROM users u INDEXED BY users_erased WHERE u.erased_at IS NOT NULL AND u.id <> ${GUEST_ACCOUNT_ID} AND EXISTS (SELECT 1 FROM moderator_log l WHERE l.target_type = 'user' AND l.target_id = u.id AND l.action = 'member.erase' AND l.actor_id = u.id) AND (u.profile_view_privacy <> 'self' OR u.profile_post_privacy <> 'self' OR ${OWN_CONTENT}) ORDER BY u.id LIMIT 1000`,
  erased: "SELECT 1 AS found FROM users WHERE id = ?1 AND erased_at IS NOT NULL AND id <> ?2",
  closeProfile:
    "UPDATE users SET profile_view_privacy = 'self', profile_post_privacy = 'self' WHERE id = ?1 AND (profile_view_privacy <> 'self' OR profile_post_privacy <> 'self')",
  // The wall of the erased profile: one post at a time, its comments in pieces.
  wall: "SELECT id FROM profile_posts WHERE profile_user_id = ?1 ORDER BY id LIMIT 1",
  wallComments:
    "SELECT id FROM profile_post_comments WHERE profile_post_id = ?1 ORDER BY id LIMIT ?2",
  threads: "SELECT id FROM threads WHERE user_id = ?1 ORDER BY id LIMIT ?2",
  posts: "SELECT id, thread_id FROM posts WHERE user_id = ?1 ORDER BY id LIMIT ?2",
  profilePosts: "SELECT id FROM profile_posts WHERE user_id = ?1 ORDER BY id LIMIT ?2",
  comments: "SELECT id FROM profile_post_comments WHERE user_id = ?1 ORDER BY id LIMIT ?2",
  messages:
    "SELECT id, conversation_id FROM conversation_messages WHERE user_id = ?1 ORDER BY id LIMIT ?2",
  // The chunk's rows change hands. A thread's last poster follows when it was the member.
  threadsMoved:
    "UPDATE threads SET user_id = ?1, guest_name = NULL, last_poster_id = CASE WHEN last_poster_id = ?2 THEN ?1 ELSE last_poster_id END WHERE id IN (SELECT value FROM json_each(?3))",
  tagAuthors:
    "UPDATE thread_tags SET author_id = ?1 WHERE thread_id IN (SELECT value FROM json_each(?2))",
  postsMoved:
    "UPDATE posts SET user_id = ?1, guest_name = NULL WHERE id IN (SELECT value FROM json_each(?2))",
  lastPosters:
    "UPDATE threads SET last_poster_id = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND last_poster_id = ?3",
  profilePostsMoved:
    "UPDATE profile_posts SET user_id = ?1 WHERE id IN (SELECT value FROM json_each(?2))",
  commentsMoved:
    "UPDATE profile_post_comments SET user_id = ?1 WHERE id IN (SELECT value FROM json_each(?2))",
  messagesMoved:
    "UPDATE conversation_messages SET user_id = ?1 WHERE id IN (SELECT value FROM json_each(?2))",
  lastMessageUsers:
    "UPDATE conversations SET last_message_user_id = ?1 WHERE id IN (SELECT value FROM json_each(?2)) AND last_message_user_id = ?3",
  // The forum tree is a few dozen rows, so no index is kept for its last poster.
  lastNodePosters: "UPDATE nodes SET last_poster_id = ?1 WHERE last_poster_id = ?2",
  noPosts: "UPDATE users SET post_count = 0 WHERE id = ?1 AND post_count <> 0",
};

function statement<Row = unknown>(ctx: Ctx, key: string) {
  return prepared(ctx, `admin.keepContent.${key}`, () =>
    ctx.sqlite.prepare<Row, (string | number)[]>(
      keepContentSql[key as keyof typeof keepContentSql],
    ),
  );
}

const idsOf = (rows: { id: number }[]) => JSON.stringify(rows.map((row) => row.id));

/**
 * The wall of the closed profile goes with it: at most a chunk of comments and wall posts
 * together. Returns how many it removed.
 */
function removeWall(ctx: Ctx, userId: number): number {
  let left = KEEP_CONTENT_CHUNK;
  while (left > 0) {
    const post = statement<{ id: number }>(ctx, "wall").get(userId);
    if (!post) break;
    const comments = statement<{ id: number }>(ctx, "wallComments").all(post.id, left);
    purgeContent(
      ctx,
      "profile_post_comment",
      comments.map((row) => row.id),
    );
    left -= comments.length;
    if (left === 0) break;
    purgeContent(ctx, "profile_post", [post.id]);
    left--;
  }
  return KEEP_CONTENT_CHUNK - left;
}

function moveThreads(ctx: Ctx, userId: number): number {
  const rows = statement<{ id: number }>(ctx, "threads").all(userId, KEEP_CONTENT_CHUNK);
  if (rows.length === 0) return 0;
  const ids = idsOf(rows);
  statement(ctx, "threadsMoved").run(GUEST_ACCOUNT_ID, userId, ids);
  statement(ctx, "tagAuthors").run(GUEST_ACCOUNT_ID, ids);
  statement(ctx, "lastNodePosters").run(GUEST_ACCOUNT_ID, userId);
  return rows.length;
}

function movePosts(ctx: Ctx, userId: number): number {
  const rows = statement<{ id: number; thread_id: number }>(ctx, "posts").all(
    userId,
    KEEP_CONTENT_CHUNK,
  );
  if (rows.length === 0) return 0;
  statement(ctx, "postsMoved").run(GUEST_ACCOUNT_ID, idsOf(rows));
  statement(ctx, "lastPosters").run(
    GUEST_ACCOUNT_ID,
    JSON.stringify([...new Set(rows.map((row) => row.thread_id))]),
    userId,
  );
  statement(ctx, "lastNodePosters").run(GUEST_ACCOUNT_ID, userId);
  return rows.length;
}

function moveWallWriting(ctx: Ctx, userId: number, rows: "profilePosts" | "comments"): number {
  const found = statement<{ id: number }>(ctx, rows).all(userId, KEEP_CONTENT_CHUNK);
  if (found.length === 0) return 0;
  statement(ctx, rows === "comments" ? "commentsMoved" : "profilePostsMoved").run(
    GUEST_ACCOUNT_ID,
    idsOf(found),
  );
  return found.length;
}

function moveMessages(ctx: Ctx, userId: number): number {
  const rows = statement<{ id: number; conversation_id: number }>(ctx, "messages").all(
    userId,
    KEEP_CONTENT_CHUNK,
  );
  if (rows.length === 0) return 0;
  statement(ctx, "messagesMoved").run(GUEST_ACCOUNT_ID, idsOf(rows));
  statement(ctx, "lastMessageUsers").run(
    GUEST_ACCOUNT_ID,
    JSON.stringify([...new Set(rows.map((row) => row.conversation_id))]),
    userId,
  );
  return rows.length;
}

/** The profile stops answering: nobody but staff who bypass privacy can open it. */
function closeProfile(ctx: Ctx, userId: number): void {
  statement(ctx, "closeProfile").run(userId);
}

/**
 * One chunk of the move, in the caller's transaction: the first kind of content the member still
 * has, up to a chunk of it. Returns whether anything is left. The wall comes first, so the member's
 * own posts on it go with it instead of moving.
 */
function moveChunk(ctx: Ctx, userId: number): boolean {
  closeProfile(ctx, userId);
  const steps = [
    () => removeWall(ctx, userId),
    () => moveThreads(ctx, userId),
    () => movePosts(ctx, userId),
    () => moveWallWriting(ctx, userId, "profilePosts"),
    () => moveWallWriting(ctx, userId, "comments"),
    () => moveMessages(ctx, userId),
  ];
  for (const step of steps) if (step() > 0) return true;
  // Nothing is theirs any more: they count no posts.
  statement(ctx, "noPosts").run(userId);
  return false;
}

/**
 * One chunk, in one transaction with the completion of its own job and the queuing of its
 * successor under the same key: a replayed run no longer owns its job and does nothing. Only an
 * erased account is touched. Returns whether more is left.
 */
export async function keepContentChunk(
  ctx: Ctx,
  userId: number,
  job: ClaimedJob,
): Promise<boolean> {
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    return writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return false;
      if (!statement(ctx, "erased").get(userId, GUEST_ACCOUNT_ID)) return false;
      const more = moveChunk(ctx, userId);
      if (more)
        enqueueJob(
          ctx,
          KEEP_CONTENT_JOB,
          { userId },
          { uniqueKey: jobKey(userId), runAt: ctx.now() + PAUSE_MS },
        );
      return more;
    });
  } finally {
    release();
  }
}

/**
 * The member has just deleted their own account: the profile closes now and the content moves in
 * the background.
 */
export function startKeepingContent(ctx: Ctx, userId: number): void {
  writeTx(ctx, () => {
    closeProfile(ctx, userId);
    enqueueJob(ctx, KEEP_CONTENT_JOB, { userId }, { uniqueKey: jobKey(userId) });
  });
}

/** Queues the move for every self-deleted account that is not done; ones queued already are left alone. */
export function scheduleKeptContent(ctx: Ctx): void {
  for (const { id } of statement<{ id: number }>(ctx, "unfinished").all())
    enqueueJob(ctx, KEEP_CONTENT_JOB, { userId: id }, { uniqueKey: jobKey(id) });
}

export function registerKeepContentJob(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    KEEP_CONTENT_JOB,
    async (context, payload, job) => {
      const userId = (payload as { userId?: unknown })?.userId;
      if (!Number.isSafeInteger(userId) || Number(userId) < 1) return;
      await keepContentChunk(context, Number(userId), job);
    },
    { holdCheckpoints: false },
  );
}
