/**
 * Deterministic generator for the benchmark dataset. Run directly (`bun run seed`) or via
 * `ensureSeed()` from the benchmark runner. The database is written outside the repository
 * (SERMO_BENCH_DIR, default ~/.cache/sermo-bench) and reused until the seed version or the
 * migrations change.
 *
 * All denormalized counters (reply counts, last-post fields, reaction counts, reaction scores,
 * post counts, participant read state) are computed here exactly as the services maintain them.
 */
import type { Database, Statement } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeContext, createContext, DEFAULT_CONFIG, renderMarkdown } from "@sermo/core";
import { Rng, ZipfSampler } from "./rng";

export const SIZES = {
  nodes: 60,
  users: 10_000,
  threads: 50_000,
  posts: 1_000_000,
  profilePosts: 100_000,
  profilePostComments: 300_000,
  conversations: 20_000,
  conversationMessages: 400_000,
  reactions: {
    post: 1_400_000,
    profile_post: 250_000,
    profile_post_comment: 150_000,
    conversation_message: 200_000,
  },
  threadReads: 200_000,
} as const;

/** Bump when the generator's output changes. */
const SEED_VERSION = 4;
const SEED = 20261004;
const T0 = Date.UTC(2021, 0, 1);
const T1 = Date.UTC(2026, 0, 1);
const DAY = 86_400_000;
export const SEED_PASSWORD = "password";

export interface SeedMeta {
  version: number;
  sizes: typeof SIZES;
  adminId: number;
  moderatorIds: number[];
  /** Active members (frequent posters), useful as actors. */
  memberIds: number[];
  forumIds: number[];
  /** Forums with the most threads, biggest first. */
  bigForumIds: number[];
  /** Visible threads with the most posts, biggest first. */
  bigThreadIds: number[];
  /** Random visible threads (typical sizes) in viewable forums. */
  threadIds: number[];
  /** Users with the most profile posts on their wall. */
  bigWallUserIds: number[];
  /** Visible profile posts, random. */
  profilePostIds: number[];
  /** [conversationId, activeParticipantUserId] pairs. */
  conversationMembers: [number, number][];
  /** Users in the most active conversations. */
  busyConversationUserIds: number[];
  /** Visible posts in visible threads, random: [postId, authorId]. */
  postAuthors: [number, number][];
  searchTerms: { common: string[]; medium: string[]; rare: string[] };
}

export function benchDir(): string {
  return process.env.SERMO_BENCH_DIR ?? join(homedir(), ".cache", "sermo-bench");
}

function migrationsHash(): string {
  const dir = join(import.meta.dir, "..", "packages", "core", "drizzle");
  const hash = createHash("sha256");
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    hash.update(file).update(readFileSync(join(dir, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

export function seedPaths(): { db: string; meta: string } {
  const base = join(benchDir(), `seed-v${SEED_VERSION}-${migrationsHash()}`);
  return { db: `${base}.db`, meta: `${base}.json` };
}

export async function ensureSeed(): Promise<{ path: string; meta: SeedMeta }> {
  const paths = seedPaths();
  if (!existsSync(paths.db) || !existsSync(paths.meta)) {
    mkdirSync(benchDir(), { recursive: true });
    const tmp = `${paths.db}.${process.pid}.tmp`;
    for (const suffix of ["", "-wal", "-shm"]) rmSync(tmp + suffix, { force: true });
    const started = performance.now();
    const meta = await generate(tmp);
    if (existsSync(paths.db)) {
      // Another process finished first; keep its copy.
      rmSync(tmp, { force: true });
    } else {
      renameSync(tmp, paths.db);
      writeFileSync(paths.meta, JSON.stringify(meta, null, 2));
    }
    console.log(
      `Seed written to ${paths.db} in ${((performance.now() - started) / 1000).toFixed(1)} s`,
    );
  }
  return { path: paths.db, meta: JSON.parse(readFileSync(paths.meta, "utf8")) as SeedMeta };
}

// ---------------------------------------------------------------------------

const REACTION_TYPE_WEIGHTS: [id: number, weight: number, score: number][] = [
  [1, 60, 1],
  [2, 15, 1],
  [3, 10, 1],
  [4, 6, 1],
  [5, 5, 0],
  [6, 4, 0],
];

function log(step: string, started: number): void {
  console.log(`  ${step} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}

async function generate(path: string): Promise<SeedMeta> {
  const started = performance.now();
  const rng = new Rng(SEED);
  const ctx = createContext({ path, migrate: true });
  const db = ctx.sqlite;
  db.run("PRAGMA synchronous = OFF");

  // Bulk insert without the FTS triggers; the index is rebuilt in one pass at the end.
  const triggers = db
    .query<{ name: string; sql: string }, []>(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger'",
    )
    .all();
  for (const t of triggers) db.run(`DROP TRIGGER ${t.name}`);

  // Vocabulary and text --------------------------------------------------------
  const vocab = buildVocabulary(rng, 6000);
  const wordSampler = new ZipfSampler(vocab.length, 1.05);
  const word = () => vocab[wordSampler.sample(rng)]!;
  const bodies = buildBodies(rng, word, 4096);
  const title = () => {
    const n = rng.int(3, 8);
    const words: string[] = [];
    for (let i = 0; i < n; i++) words.push(word());
    const s = words.join(" ");
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  log("text pool", started);

  // Users ----------------------------------------------------------------------
  const U = SIZES.users;
  const passwordHash = await Bun.password.hash(SEED_PASSWORD, DEFAULT_CONFIG.passwordHash);
  const userGroup = new Uint8Array(U + 1);
  const userPostCount = new Uint32Array(U + 1);
  const userReactionScore = new Int32Array(U + 1);
  for (let id = 1; id <= U; id++) userGroup[id] = id === 1 ? 4 : id <= 21 ? 3 : 2;
  // Activity follows a Zipf curve over a shuffled order, so active users are not just low ids.
  const activeOrder = shuffle(rng, range(1, U));
  const activeSampler = new ZipfSampler(U, 0.9);
  const activeUser = () => activeOrder[activeSampler.sample(rng)]!;
  const anyUser = () => rng.int(1, U);

  // Nodes ----------------------------------------------------------------------
  interface NodeRow {
    id: number;
    parentId: number | null;
    type: "category" | "forum";
    title: string;
    position: number;
  }
  const nodeRows: NodeRow[] = [];
  const forumIds: number[] = [];
  for (let c = 0; c < 6; c++) {
    const catId = nodeRows.length + 1;
    nodeRows.push({
      id: catId,
      parentId: null,
      type: "category",
      title: title(),
      position: c * 10,
    });
    let firstForum = 0;
    for (let f = 0; f < 9; f++) {
      const id = nodeRows.length + 1;
      const parentId = f < 6 ? catId : firstForum;
      if (f === 0) firstForum = id;
      nodeRows.push({ id, parentId, type: "forum", title: title(), position: f * 10 });
      forumIds.push(id);
    }
  }
  const forumOrder = shuffle(rng, forumIds);
  const forumSampler = new ZipfSampler(forumOrder.length, 0.8);

  // Threads and posts (computed in memory first) -------------------------------
  const T = SIZES.threads;
  const P = SIZES.posts;
  const threadNode = new Uint16Array(T + 1);
  const threadAuthor = new Uint32Array(T + 1);
  const threadCreated = new Float64Array(T + 1);
  const threadState = new Uint8Array(T + 1); // 0 visible, 1 moderated, 2 deleted
  const threadSticky = new Uint8Array(T + 1);
  const threadLocked = new Uint8Array(T + 1);
  const threadPostTotal = new Uint32Array(T + 1);
  const threadTitles: string[] = new Array(T + 1);
  const createdTimes = sortedUniform(rng, T, T0, T1 - 7 * DAY);
  const stickyCount = new Map<number, number>();
  for (let t = 1; t <= T; t++) {
    const node = forumOrder[forumSampler.sample(rng)]!;
    threadNode[t] = node;
    threadAuthor[t] = activeUser();
    threadCreated[t] = createdTimes[t - 1]!;
    threadState[t] = rng.chance(0.005) ? 2 : rng.chance(0.002) ? 1 : 0;
    const stickies = stickyCount.get(node) ?? 0;
    if (stickies < 2 && rng.chance(0.01)) {
      threadSticky[t] = 1;
      stickyCount.set(node, stickies + 1);
    }
    threadLocked[t] = rng.chance(0.01) ? 1 : 0;
    threadTitles[t] = title();
  }
  distribute(rng, P - T, T, 1.1, 3000, (t, n) => {
    threadPostTotal[t + 1] = n + 1;
  });

  const postThread = new Uint32Array(P);
  const postTime = new Float64Array(P);
  {
    let k = 0;
    for (let t = 1; t <= T; t++) {
      const n = threadPostTotal[t]!;
      const start = threadCreated[t]!;
      const span = Math.min(T1 - start, n * rng.int(1, 72) * 3_600_000);
      postThread[k] = t;
      postTime[k] = start;
      k++;
      const replies = sortedUniform(rng, n - 1, start + 60_000, start + span);
      for (const time of replies) {
        postThread[k] = t;
        postTime[k] = time;
        k++;
      }
    }
  }
  // Insert in global time order so ids increase with time, as in a live forum.
  const postOrder = sortIndexByTime(postTime);
  const postAuthor = new Uint32Array(P);
  const postState = new Uint8Array(P);
  const postPosition = new Uint32Array(P);
  const postBody = new Uint16Array(P);
  const threadVisible = new Uint32Array(T + 1);
  const threadSeen = new Uint32Array(T + 1);
  const threadFirstPost = new Uint32Array(T + 1);
  const threadLastPost = new Uint32Array(T + 1);
  const threadLastAt = new Float64Array(T + 1);
  const threadLastPoster = new Uint32Array(T + 1);
  const threadLastPosition = new Uint32Array(T + 1);
  for (let rank = 0; rank < P; rank++) {
    const k = postOrder[rank]!;
    const t = postThread[k]!;
    const postId = rank + 1;
    const isFirst = threadSeen[t] === 0;
    threadSeen[t]!++;
    postAuthor[k] = isFirst ? threadAuthor[t]! : activeUser();
    postState[k] = isFirst ? 0 : rng.chance(0.01) ? 2 : rng.chance(0.003) ? 1 : 0;
    // Positions follow creation order and never change (hidden posts keep theirs).
    postPosition[k] = threadSeen[t]! - 1;
    postBody[k] = rng.int(0, bodies.length - 1);
    if (isFirst) threadFirstPost[t] = postId;
    if (postState[k] === 0) {
      threadVisible[t]!++;
      threadLastPost[t] = postId;
      threadLastAt[t] = postTime[k]!;
      threadLastPoster[t] = postAuthor[k]!;
      threadLastPosition[t] = postPosition[k]!;
      if (threadState[t] === 0) userPostCount[postAuthor[k]!]!++;
    }
  }
  const postReactions = allocate(rng, SIZES.reactions.post, P, 1.5, 300);
  log("threads and posts planned", started);

  // Write users, nodes, threads --------------------------------------------------
  tx(db, () => {
    // Identity in Better Auth's tables (auth_user + a credential account with the password
    // hash), forum data in Sermo's users table, as the auth module does on sign-up.
    const insertAuthUser = db.prepare(
      "INSERT INTO auth_user (id, name, email, email_verified, username, display_username, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)",
    );
    const insertAccount = db.prepare(
      "INSERT INTO auth_account (account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, 'credential', ?, ?, ?, ?)",
    );
    const insertUser = db.prepare(
      "INSERT INTO users (id, username, username_key, group_id, about, created_at, post_count) VALUES (?, ?, ?, ?, '', ?, ?)",
    );
    for (let id = 1; id <= U; id++) {
      const w = vocab[(id * 7919) % vocab.length]!;
      const username = `${w.charAt(0).toUpperCase()}${w.slice(1)}${id}`;
      const createdAt = T0 - rng.int(0, 365) * DAY;
      insertAuthUser.run(
        id,
        username,
        `user${id}@example.test`,
        username.toLowerCase(),
        username,
        createdAt,
        createdAt,
      );
      insertAccount.run(String(id), id, passwordHash, createdAt, createdAt);
      insertUser.run(
        id,
        username,
        username.toLowerCase(),
        userGroup[id]!,
        createdAt,
        userPostCount[id]!,
      );
    }
    // Node counters: visible threads only.
    const nodeStats = new Map<
      number,
      { threads: number; posts: number; lastAt: number; lastThread: number }
    >();
    for (let t = 1; t <= T; t++) {
      if (threadState[t] !== 0) continue;
      const node = threadNode[t]!;
      const s = nodeStats.get(node) ?? { threads: 0, posts: 0, lastAt: 0, lastThread: 0 };
      s.threads++;
      s.posts += threadVisible[t]!;
      if (threadLastAt[t]! > s.lastAt) {
        s.lastAt = threadLastAt[t]!;
        s.lastThread = t;
      }
      nodeStats.set(node, s);
    }
    const insertNode = db.prepare(
      "INSERT INTO nodes (id, parent_id, type, title, description, position, thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const n of nodeRows) {
      const s = nodeStats.get(n.id);
      const lt = s?.lastThread ?? 0;
      insertNode.run(
        n.id,
        n.parentId,
        n.type,
        n.title,
        n.position,
        s?.threads ?? 0,
        s?.posts ?? 0,
        lt ? threadLastAt[lt]! : null,
        lt ? threadLastPost[lt]! : null,
        lt || null,
        lt ? threadTitles[lt]! : null,
        lt ? threadLastPoster[lt]! : null,
      );
    }
    const insertThread = db.prepare(
      "INSERT INTO threads (id, node_id, user_id, title, state, is_sticky, is_locked, created_at, reply_count, view_count, first_post_id, last_post_at, last_post_id, last_poster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (let t = 1; t <= T; t++) {
      insertThread.run(
        t,
        threadNode[t]!,
        threadAuthor[t]!,
        threadTitles[t]!,
        STATES[threadState[t]!]!,
        threadSticky[t]!,
        threadLocked[t]!,
        threadCreated[t]!,
        threadVisible[t]! - 1,
        Math.floor(threadPostTotal[t]! * rng.int(5, 40)),
        threadFirstPost[t]!,
        threadLastAt[t]!,
        threadLastPost[t]!,
        threadLastPoster[t]!,
      );
    }
  });
  log("users, nodes, threads", started);

  // Posts with their reactions ------------------------------------------------
  const reactionInsert = db.prepare(
    "INSERT INTO reactions (content_type, content_id, user_id, content_user_id, reaction_type_id, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const react = makeReactor(rng, reactionInsert, userReactionScore);
  {
    const insertPost = db.prepare(
      "INSERT INTO posts (id, thread_id, user_id, position, state, created_at, reaction_counts) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertBody = db.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?, ?, ?)",
    );
    batched(db, P, (rank) => {
      const k = postOrder[rank]!;
      const id = rank + 1;
      const author = postAuthor[k]!;
      const counts = react("post", id, author, postTime[k]!, postReactions[k]!, anyUser);
      const body = bodies[postBody[k]!]!;
      insertPost.run(
        id,
        postThread[k]!,
        author,
        postPosition[k]!,
        STATES[postState[k]!]!,
        postTime[k]!,
        counts,
      );
      insertBody.run(id, body.source, body.html);
    });
  }
  log("posts and post reactions", started);

  // Profile posts and comments -------------------------------------------------
  const PP = SIZES.profilePosts;
  const PC = SIZES.profilePostComments;
  const ppTimes = sortedUniform(rng, PP, T0, T1 - DAY);
  const ppOwner = new Uint32Array(PP + 1);
  const ppAuthor = new Uint32Array(PP + 1);
  const ppState = new Uint8Array(PP + 1);
  const ppCommentTotal = new Uint32Array(PP + 1);
  const ppCommentCount = new Uint32Array(PP + 1);
  const ppLastComment = new Float64Array(PP + 1);
  for (let i = 1; i <= PP; i++) {
    ppOwner[i] = activeUser();
    ppAuthor[i] = rng.chance(0.5) ? ppOwner[i]! : activeUser();
    ppState[i] = rng.chance(0.01) ? 2 : 0;
  }
  distribute(rng, PC, PP, 1.3, 400, (i, n) => {
    ppCommentTotal[i + 1] = n;
  });
  const cParent = new Uint32Array(PC);
  const cTime = new Float64Array(PC);
  {
    let k = 0;
    for (let i = 1; i <= PP; i++) {
      const start = ppTimes[i - 1]!;
      for (const time of sortedUniform(
        rng,
        ppCommentTotal[i]!,
        start + 60_000,
        Math.min(T1, start + 30 * DAY),
      )) {
        cParent[k] = i;
        cTime[k] = time;
        k++;
      }
    }
  }
  const cOrder = sortIndexByTime(cTime);
  const cAuthor = new Uint32Array(PC);
  const cState = new Uint8Array(PC);
  for (let k = 0; k < PC; k++) {
    cAuthor[k] = activeUser();
    cState[k] = rng.chance(0.01) ? 2 : 0;
    if (cState[k] === 0) {
      const p = cParent[k]!;
      ppCommentCount[p]!++;
      if (cTime[k]! > ppLastComment[p]!) ppLastComment[p] = cTime[k]!;
    }
  }
  const ppReactions = allocate(rng, SIZES.reactions.profile_post, PP, 1.5, 200);
  const cReactions = allocate(rng, SIZES.reactions.profile_post_comment, PC, 1.5, 100);
  {
    const insertPP = db.prepare(
      "INSERT INTO profile_posts (id, profile_user_id, user_id, state, created_at, body_source, body_html, reaction_counts, comment_count, last_comment_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    batched(db, PP, (i0) => {
      const i = i0 + 1;
      const time = ppTimes[i0]!;
      const body = rng.pick(bodies);
      const counts = react("profile_post", i, ppAuthor[i]!, time, ppReactions[i0]!, anyUser);
      insertPP.run(
        i,
        ppOwner[i]!,
        ppAuthor[i]!,
        STATES[ppState[i]!]!,
        time,
        body.source,
        body.html,
        counts,
        ppCommentCount[i]!,
        ppLastComment[i]! || null,
      );
    });
    const insertC = db.prepare(
      "INSERT INTO profile_post_comments (id, profile_post_id, user_id, state, created_at, body_source, body_html, reaction_counts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    batched(db, PC, (rank) => {
      const k = cOrder[rank]!;
      const id = rank + 1;
      const body = rng.pick(bodies);
      const counts = react(
        "profile_post_comment",
        id,
        cAuthor[k]!,
        cTime[k]!,
        cReactions[k]!,
        anyUser,
      );
      insertC.run(
        id,
        cParent[k]!,
        cAuthor[k]!,
        STATES[cState[k]!]!,
        cTime[k]!,
        body.source,
        body.html,
        counts,
      );
    });
  }
  log("profile posts and comments", started);

  // Conversations ----------------------------------------------------------------
  const C = SIZES.conversations;
  const M = SIZES.conversationMessages;
  const convTimes = sortedUniform(rng, C, T0, T1 - DAY);
  const convParticipants: number[][] = new Array(C + 1);
  const convMessageTotal = new Uint32Array(C + 1);
  for (let c = 1; c <= C; c++) {
    const r = rng.next();
    const n = r < 0.7 ? 2 : r < 0.85 ? 3 : r < 0.95 ? 4 : 5;
    const set = new Set<number>();
    while (set.size < n) set.add(activeUser());
    convParticipants[c] = [...set];
  }
  distribute(rng, M - C, C, 1.3, 2000, (c, n) => {
    convMessageTotal[c + 1] = n + 1;
  });
  const mConv = new Uint32Array(M);
  const mTime = new Float64Array(M);
  {
    let k = 0;
    for (let c = 1; c <= C; c++) {
      const start = convTimes[c - 1]!;
      const n = convMessageTotal[c]!;
      mConv[k] = c;
      mTime[k] = start;
      k++;
      const span = Math.min(T1 - start, n * rng.int(1, 48) * 3_600_000);
      for (const time of sortedUniform(rng, n - 1, start + 60_000, start + span)) {
        mConv[k] = c;
        mTime[k] = time;
        k++;
      }
    }
  }
  const mOrder = sortIndexByTime(mTime);
  const mAuthor = new Uint32Array(M);
  const convSeen = new Uint32Array(C + 1);
  const convLastMessage = new Uint32Array(C + 1);
  const convLastAt = new Float64Array(C + 1);
  const convLastUser = new Uint32Array(C + 1);
  const convFirstMessage = new Uint32Array(C + 1);
  for (let rank = 0; rank < M; rank++) {
    const k = mOrder[rank]!;
    const c = mConv[k]!;
    const parts = convParticipants[c]!;
    mAuthor[k] = convSeen[c] === 0 ? parts[0]! : rng.pick(parts);
    if (convSeen[c] === 0) convFirstMessage[c] = rank + 1;
    convSeen[c]!++;
    convLastMessage[c] = rank + 1;
    convLastAt[c] = mTime[k]!;
    convLastUser[c] = mAuthor[k]!;
  }
  // Message reactions: only other participants may react, so cap per message.
  const mReactions = new Uint8Array(M);
  for (
    let placed = 0, guard = 0;
    placed < SIZES.reactions.conversation_message && guard < M * 20;
    guard++
  ) {
    const k = rng.int(0, M - 1);
    if (mReactions[k]! < convParticipants[mConv[k]!]!.length - 1) {
      mReactions[k]!++;
      placed++;
    }
  }
  {
    const insertConv = db.prepare(
      "INSERT INTO conversations (id, title, user_id, created_at, last_message_at, last_message_id, last_message_user_id, message_count, participant_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertPart = db.prepare(
      "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at, last_read_message_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    batched(db, C, (c0) => {
      const c = c0 + 1;
      const parts = convParticipants[c]!;
      let active = 0;
      const states = parts.map((_, i) => (i > 0 && rng.chance(0.03) ? "left" : "active"));
      for (const s of states) if (s === "active") active++;
      insertConv.run(
        c,
        title(),
        parts[0]!,
        convTimes[c0]!,
        convLastAt[c]!,
        convLastMessage[c]!,
        convLastUser[c]!,
        convMessageTotal[c]!,
        active,
      );
      parts.forEach((userId, i) => {
        const lastRead = rng.chance(0.8) ? convLastMessage[c]! : convFirstMessage[c]!;
        insertPart.run(c, userId, states[i]!, convTimes[c0]!, convLastAt[c]!, lastRead);
      });
    });
    const insertMsg = db.prepare(
      "INSERT INTO conversation_messages (id, conversation_id, user_id, state, created_at, body_source, body_html, reaction_counts) VALUES (?, ?, ?, 'visible', ?, ?, ?, ?)",
    );
    batched(db, M, (rank) => {
      const k = mOrder[rank]!;
      const id = rank + 1;
      const parts = convParticipants[mConv[k]!]!;
      const body = rng.pick(bodies);
      const counts = react("conversation_message", id, mAuthor[k]!, mTime[k]!, mReactions[k]!, () =>
        rng.pick(parts),
      );
      insertMsg.run(id, mConv[k]!, mAuthor[k]!, mTime[k]!, body.source, body.html, counts);
    });
  }
  log("conversations and messages", started);

  // Reaction scores, thread reads ------------------------------------------------
  tx(db, () => {
    const upd = db.prepare("UPDATE users SET reaction_score = ? WHERE id = ?");
    for (let id = 1; id <= U; id++)
      if (userReactionScore[id] !== 0) upd.run(userReactionScore[id]!, id);
    const insertRead = db.prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?, ?, ?, ?, ?)",
    );
    const readers = new Set<number>();
    while (readers.size < 2000) readers.add(activeUser());
    const perUser = SIZES.threadReads / readers.size;
    for (const userId of readers) {
      const seen = new Set<number>();
      while (seen.size < perUser) {
        const t = rng.int(1, T);
        if (threadState[t] !== 0 || seen.has(t)) continue;
        seen.add(t);
        // Half fully read, half read only up to the first post.
        if (rng.chance(0.5)) {
          insertRead.run(userId, t, threadLastPost[t]!, threadLastPosition[t]!, threadLastAt[t]!);
        } else {
          insertRead.run(userId, t, threadFirstPost[t]!, 0, threadCreated[t]!);
        }
      }
    }
  });
  log("reaction scores and thread reads", started);

  // Search index, triggers, statistics -------------------------------------------
  db.run(
    "INSERT INTO search_fts (rowid, title, body) SELECT p.id, CASE WHEN t.first_post_id = p.id THEN t.title ELSE '' END, b.body_source FROM posts p JOIN threads t ON t.id = p.thread_id JOIN post_bodies b ON b.post_id = p.id",
  );
  for (const t of triggers) db.run(t.sql);
  log("search index", started);
  db.run("ANALYZE");
  db.run("PRAGMA wal_checkpoint(TRUNCATE)");
  log("analyze", started);

  const meta = buildMeta(db, vocab, forumIds);
  closeContext(ctx);
  for (const suffix of ["-wal", "-shm"]) rmSync(path + suffix, { force: true });
  return meta;
}

// ---------------------------------------------------------------------------

const STATES = ["visible", "moderated", "deleted"] as const;

function makeReactor(rng: Rng, insert: Statement, scores: Int32Array) {
  const totalWeight = REACTION_TYPE_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const pickType = () => {
    let r = rng.next() * totalWeight;
    for (const entry of REACTION_TYPE_WEIGHTS) {
      r -= entry[1];
      if (r < 0) return entry;
    }
    return REACTION_TYPE_WEIGHTS[0]!;
  };
  const used = new Set<number>();
  /** Inserts `n` reactions from distinct users (never the author); returns reaction_counts JSON. */
  return (
    type: string,
    contentId: number,
    authorId: number,
    time: number,
    n: number,
    candidate: () => number,
  ): string => {
    if (n === 0) return "{}";
    used.clear();
    const counts: Record<number, number> = {};
    for (let attempts = 0; used.size < n && attempts < n * 20; attempts++) {
      const userId = candidate();
      if (userId === authorId || used.has(userId)) continue;
      used.add(userId);
      const [typeId, , score] = pickType();
      counts[typeId] = (counts[typeId] ?? 0) + 1;
      scores[authorId]! += score;
      insert.run(type, contentId, userId, authorId, typeId, score, time + rng.int(1, 2 * DAY));
    }
    return JSON.stringify(counts);
  };
}

function buildMeta(db: Database, vocab: string[], forumIds: number[]): SeedMeta {
  const ids = (sql: string) =>
    db
      .query<{ id: number }, []>(sql)
      .all()
      .map((r) => r.id);
  const memberIds = ids(
    "SELECT id FROM users WHERE group_id = 2 ORDER BY post_count DESC LIMIT 200",
  );
  return {
    version: SEED_VERSION,
    sizes: SIZES,
    adminId: 1,
    moderatorIds: ids("SELECT id FROM users WHERE group_id = 3 ORDER BY id"),
    memberIds,
    forumIds,
    bigForumIds: ids(
      "SELECT id FROM nodes WHERE type = 'forum' ORDER BY thread_count DESC LIMIT 5",
    ),
    bigThreadIds: ids(
      "SELECT id FROM threads WHERE state = 'visible' ORDER BY reply_count DESC LIMIT 10",
    ),
    threadIds: ids(
      "SELECT id FROM threads WHERE state = 'visible' ORDER BY (id * 2654435761) % 1000003 LIMIT 500",
    ),
    bigWallUserIds: ids(
      "SELECT profile_user_id AS id FROM profile_posts GROUP BY profile_user_id ORDER BY count(*) DESC LIMIT 10",
    ),
    profilePostIds: ids(
      "SELECT id FROM profile_posts WHERE state = 'visible' ORDER BY (id * 2654435761) % 1000003 LIMIT 500",
    ),
    conversationMembers: db
      .query<{ c: number; u: number }, []>(
        "SELECT conversation_id AS c, user_id AS u FROM conversation_participants WHERE state = 'active' ORDER BY (id * 2654435761) % 1000003 LIMIT 500",
      )
      .all()
      .map((r) => [r.c, r.u]),
    busyConversationUserIds: ids(
      "SELECT user_id AS id FROM conversation_participants WHERE state = 'active' GROUP BY user_id ORDER BY count(*) DESC LIMIT 10",
    ),
    postAuthors: db
      .query<{ id: number; u: number }, []>(
        "SELECT p.id, p.user_id AS u FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.state = 'visible' AND t.state = 'visible' ORDER BY (p.id * 2654435761) % 1000003 LIMIT 500",
      )
      .all()
      .map((r) => [r.id, r.u]),
    searchTerms: {
      common: vocab.slice(0, 5),
      medium: vocab.slice(200, 210),
      rare: vocab.slice(4000, 4010),
    },
  };
}

/** Pronounceable synthetic words, ordered so index 0 is the most frequent. */
function buildVocabulary(rng: Rng, n: number): string[] {
  const onsets = [
    "b",
    "c",
    "d",
    "f",
    "g",
    "h",
    "j",
    "k",
    "l",
    "m",
    "n",
    "p",
    "r",
    "s",
    "t",
    "v",
    "w",
    "z",
    "br",
    "ch",
    "cr",
    "dr",
    "fl",
    "gr",
    "pl",
    "pr",
    "sh",
    "st",
    "th",
    "tr",
  ];
  const vowels = ["a", "e", "i", "o", "u", "ai", "ea", "io", "ou"];
  const codas = ["", "", "n", "r", "s", "t", "l", "m", "nd", "st", "x"];
  const words = new Set<string>();
  while (words.size < n) {
    const syllables = rng.int(1, 3);
    let w = "";
    for (let i = 0; i < syllables; i++) w += rng.pick(onsets) + rng.pick(vowels) + rng.pick(codas);
    if (w.length >= 3) words.add(w);
  }
  return [...words];
}

function buildBodies(rng: Rng, word: () => string, n: number): { source: string; html: string }[] {
  const out: { source: string; html: string }[] = [];
  for (let i = 0; i < n; i++) {
    const paragraphs: string[] = [];
    const pCount = rng.int(1, 4);
    for (let p = 0; p < pCount; p++) {
      const sentences: string[] = [];
      for (let s = rng.int(1, 3); s > 0; s--) {
        const words: string[] = [];
        for (let w = rng.int(5, 14); w > 0; w--) {
          const x = word();
          words.push(rng.chance(0.03) ? `**${x}**` : rng.chance(0.02) ? `_${x}_` : x);
        }
        const sentence = words.join(" ");
        sentences.push(`${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`);
      }
      paragraphs.push(sentences.join(" "));
    }
    if (rng.chance(0.1))
      paragraphs.push(`- ${word()} ${word()}\n- ${word()} ${word()}\n- ${word()}`);
    if (rng.chance(0.05))
      paragraphs.push(`See [${word()}](https://example.com/${word()}) for more.`);
    const source = paragraphs.join("\n\n");
    out.push({ source, html: renderMarkdown(source) });
  }
  return out;
}

function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function sortedUniform(rng: Rng, n: number, from: number, to: number): Float64Array {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.floor(from + rng.next() * Math.max(1, to - from));
  return out.sort();
}

function sortIndexByTime(times: Float64Array): Uint32Array {
  const order = new Uint32Array(times.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  return order.sort((a, b) => times[a]! - times[b]! || a - b);
}

/** Splits `total` items over `buckets` with Pareto weights; calls `set(bucket, count)` for each. */
function distribute(
  rng: Rng,
  total: number,
  buckets: number,
  alpha: number,
  cap: number,
  set: (bucket: number, count: number) => void,
): void {
  const counts = allocate(rng, total, buckets, alpha, cap);
  for (let i = 0; i < buckets; i++) set(i, counts[i]!);
}

function allocate(
  rng: Rng,
  total: number,
  buckets: number,
  alpha: number,
  cap: number,
): Uint32Array {
  const weights = new Float64Array(buckets);
  let sum = 0;
  for (let i = 0; i < buckets; i++) {
    weights[i] = rng.pareto(alpha, cap) - 1;
    sum += weights[i]!;
  }
  const counts = new Uint32Array(buckets);
  let assigned = 0;
  for (let i = 0; i < buckets; i++) {
    counts[i] = Math.floor((weights[i]! / sum) * total);
    assigned += counts[i]!;
  }
  while (assigned < total) {
    counts[rng.int(0, buckets - 1)]!++;
    assigned++;
  }
  return counts;
}

function tx(db: Database, fn: () => void): void {
  db.transaction(fn).immediate();
}

/** Runs `fn(i)` for i in [0, n) in transactions of 50k rows. */
function batched(db: Database, n: number, fn: (i: number) => void): void {
  for (let start = 0; start < n; start += 50_000) {
    const end = Math.min(n, start + 50_000);
    tx(db, () => {
      for (let i = start; i < end; i++) fn(i);
    });
  }
}

if (import.meta.main) {
  const { path } = await ensureSeed();
  console.log(path);
}
