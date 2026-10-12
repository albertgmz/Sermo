import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isAccent, isCover } from "@/lib/appearance";
import { type Level, levelForXp, titleForLevel } from "@/lib/levels";
import {
  awardSlots,
  PERMISSIONS,
  type Permission,
  type PermissionKey,
  SIGNATURE_MAX_LENGTH,
  SIGNATURE_MAX_LINES,
  TITLE_MAX_LENGTH,
  USERNAME_PATTERN,
} from "@/lib/permissions";
import {
  compareStanding,
  inMonth,
  type Month,
  monthOf,
  previousMonth,
  type Standing,
  standingPoints,
} from "@/lib/standing";
import type {
  Appearance,
  Award,
  AwardTier,
  Category,
  ClientInfo,
  Conversation,
  Database,
  Forum,
  ForumTab,
  Message,
  Notification,
  NotificationType,
  Post,
  Prefix,
  ProfileComment,
  ProfilePost,
  Rank,
  Reaction,
  ReactionType,
  Role,
  Session,
  ShopCategory,
  ShopItem,
  Thread,
  Transaction,
  User,
} from "@/lib/types";

export type UserAwardView = Award & {
  awardedAt: string;
};

export type PermissionSource = "purchase" | "rank" | "staff";

export type PermissionView = Permission & {
  granted: boolean;
  source: PermissionSource | null;
  // Only for consumable permissions: how many uses a member has left. Staff
  // are not counted.
  quantity?: number;
};

export type UserView = Omit<User, "title"> & {
  // The custom title when the member may show one, else the derived one.
  title: string;
  customTitle: string | null;
  permissions: PermissionKey[];
  awardSlots: { mobile: number; desktop: number };
  referralCount: number;
  threadCount: number;
  postCount: number;
  reactionCount: number;
  followerCount: number;
  followingCount: number;
  xp: number;
  level: Level;
  awards: UserAwardView[];
  rank: Rank | null;
};

export type ReactionsView = {
  total: number;
  byType: { type: ReactionType; count: number }[];
  viewerTypeId: number | null;
  users: { user: UserView; type: ReactionType }[];
};

export type ReactionTarget =
  | "post"
  | "profilePost"
  | "profileComment"
  | "message";

export type AwardView = Award & {
  holders: { user: UserView; awardedAt: string }[];
};

export type InventoryItemView = ShopItem & {
  acquiredAt: string;
  quantity: number;
};

export type OwnedItems = Record<ShopCategory, InventoryItemView[]>;

export type PurchaseFailure = {
  ok: false;
  error: "not_found" | "already_owned" | "insufficient_credits";
};

export type PurchaseResult = { ok: true } | PurchaseFailure;

export type AppearanceResult =
  | { ok: true; appearance: Appearance }
  | {
      ok: false;
      error: "not_found" | "invalid" | "not_owned" | "not_allowed";
    };

export type BoostResult =
  | { ok: true; thread: ThreadView }
  | { ok: false; error: "not_found" | "not_owned" | "not_author" };

export type ThreadCoverResult = BoostResult;

export type ThreadCoverRemoval =
  | { ok: true; thread: ThreadView }
  | { ok: false; error: "not_found" | "not_author" };

export type SignatureResult =
  | { ok: true; signature: string | null }
  | {
      ok: false;
      error: "not_found" | "not_allowed" | "too_long" | "too_many_lines";
    };

export type TitleResult =
  | { ok: true; title: string | null }
  | { ok: false; error: "not_found" | "not_allowed" | "too_long" };

export type UsernameResult =
  | { ok: true; username: string }
  | { ok: false; error: "not_found" | "not_allowed" | "invalid" | "taken" };

export type StandingEntry = Standing & {
  user: UserView;
};

export type MonthWinner = StandingEntry & Month;

export type RankResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "not_higher" | "insufficient_credits" };

export type LastPostView = {
  postId: number;
  threadId: number;
  threadTitle: string;
  prefix: Prefix | null;
  createdAt: string;
  author: UserView;
};

export type ForumView = Forum & {
  categoryId: number;
  categoryTitle: string;
  tab: ForumTab;
  threadCount: number;
  postCount: number;
  lastPost: LastPostView | null;
};

export type CategoryView = Omit<Category, "forums"> & {
  forums: ForumView[];
};

export type ThreadView = Thread & {
  author: UserView;
  forum: Pick<ForumView, "id" | "slug" | "title" | "categoryTitle" | "tab">;
  prefix: Prefix | null;
  highlighted: boolean;
  excerpt: string;
  postCount: number;
  replyCount: number;
  reactionCount: number;
  lastPost: LastPostView;
};

export type ForumStats = {
  latestPosts: ThreadView[];
  latestThreads: ThreadView[];
  mostReplied: ThreadView[];
  mostReacted: ThreadView[];
  mostViewed: ThreadView[];
};

export type PostView = Omit<Post, "reactions"> & {
  author: UserView;
  reactions: ReactionsView;
  number: number;
  isThreadAuthor: boolean;
  thread: Pick<ThreadView, "id" | "title" | "prefix">;
};

export type ProfileCommentView = Omit<ProfileComment, "reactions"> & {
  author: UserView;
  reactions: ReactionsView;
};

export type ProfilePostView = Omit<ProfilePost, "comments" | "reactions"> & {
  author: UserView;
  profileUser: UserView;
  reactions: ReactionsView;
  comments: ProfileCommentView[];
};

export type FeedItem = {
  id: string;
  createdAt: string;
  author: UserView;
  following: boolean;
} & (
  | { type: "thread"; thread: ThreadView; post: PostView }
  | { type: "post"; thread: ThreadView; post: PostView }
  | { type: "profilePost"; profilePost: ProfilePostView }
);

export type MessageView = Omit<Message, "reactions"> & {
  author: UserView;
  reactions: ReactionsView;
};

export type ConversationView = Omit<Conversation, "messages"> & {
  participants: UserView[];
  messages: MessageView[];
  lastMessage: MessageView;
  unread: boolean;
};

export type NotificationView = Notification & {
  actor: UserView;
  prefix: Prefix | null;
};

export type UnreadCounts = {
  conversations: number;
  notifications: number;
};

const DB_PATH = path.join(process.cwd(), "data", "db.json");

const READ_ATTEMPTS = 5;

// A request can read the file while another one is still writing it.
async function read(attempt = 1): Promise<Database> {
  const raw = await readFile(DB_PATH, "utf8");
  try {
    return JSON.parse(raw);
  } catch (error) {
    if (attempt === READ_ATTEMPTS) throw error;
    await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
    return read(attempt + 1);
  }
}

async function write(db: Database) {
  await writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function nextId(items: { id: number }[]) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function newest<T extends { createdAt: string }>(a: T, b: T) {
  return b.createdAt.localeCompare(a.createdAt);
}

const TIERS: AwardTier[] = ["legendary", "gold", "silver", "bronze"];

function bestAward(a: Award, b: Award) {
  return TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || b.xp - a.xp;
}

const EXCERPT_LENGTH = 180;

function excerpt(markdown: string) {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= EXCERPT_LENGTH) return text;
  const cut = text.lastIndexOf(" ", EXCERPT_LENGTH);
  return `${text.slice(0, cut > 0 ? cut : EXCERPT_LENGTH)}…`;
}

const STAFF_TITLES: Partial<Record<Role, string>> = {
  admin: "Administrator",
  moderator: "Moderator",
};

function isStaff(user: User) {
  return user.role !== "member";
}

function permissionsOf(db: Database, user: User): PermissionView[] {
  const rank = db.ranks.find((r) => r.id === user.rankId);
  const ranked = db.ranks.flatMap((r) =>
    rank && r.price <= rank.price ? r.permissions : [],
  );
  const owned = inventory(db, user.id);
  return PERMISSIONS.map((permission) => {
    const grants = (item: ShopItem) =>
      item.effect.type === "permission" &&
      item.effect.permission === permission.key;
    const held = owned.find(grants);
    let source: PermissionSource | null = null;
    if (isStaff(user)) source = "staff";
    else if (ranked.includes(permission.key)) source = "rank";
    else if (held) source = "purchase";
    return {
      ...permission,
      granted: source !== null,
      source,
      ...(db.shopItems.find(grants)?.consumable && !isStaff(user)
        ? { quantity: held?.quantity ?? 0 }
        : {}),
    };
  });
}

function holds(db: Database, user: User, key: PermissionKey) {
  return permissionsOf(db, user).some((p) => p.key === key && p.granted);
}

function isHighlighted(thread: Thread, now: string) {
  return thread.highlightedUntil !== null && thread.highlightedUntil > now;
}

function lastActivity(thread: ThreadView) {
  const { createdAt } = thread.lastPost;
  return thread.bumpedAt && thread.bumpedAt > createdAt
    ? thread.bumpedAt
    : createdAt;
}

function views(db: Database, viewerId: number | null) {
  const users = new Map<number, UserView>();
  const threads = new Map<number, ThreadView>();
  const forums = new Map<number, ForumView>();
  const now = new Date().toISOString();

  function user(id: number): UserView {
    const cached = users.get(id);
    if (cached) return cached;
    const base = db.users.find((u) => u.id === id);
    if (!base) throw new Error(`Unknown user ${id}`);
    const posts = db.posts.filter((p) => p.authorId === id);
    const reactable = [
      ...posts,
      ...db.profilePosts.flatMap((p) => [p, ...p.comments]),
    ].filter((item) => item.authorId === id);
    const awards = db.userAwards
      .filter((entry) => entry.userId === id)
      .flatMap(({ awardId, awardedAt }) => {
        const award = db.awards.find((a) => a.id === awardId);
        return award ? [{ ...award, awardedAt }] : [];
      })
      .toSorted(bestAward);
    const xp = awards.reduce((sum, award) => sum + award.xp, 0);
    const level = levelForXp(xp);
    const permissions = permissionsOf(db, base).flatMap((p) =>
      p.granted ? [p.key] : [],
    );
    const view: UserView = {
      ...base,
      title:
        (permissions.includes("customTitle") && base.title) ||
        STAFF_TITLES[base.role] ||
        titleForLevel(level.level),
      customTitle: base.title,
      permissions,
      awardSlots: awardSlots({ permissions }),
      referralCount: db.users.filter((u) => u.referredBy === id).length,
      threadCount: db.threads.filter((t) => t.authorId === id).length,
      postCount: posts.length,
      reactionCount: reactable.reduce(
        (sum, item) => sum + item.reactions.length,
        0,
      ),
      followerCount: db.follows.filter((f) => f.followingId === id).length,
      followingCount: db.follows.filter((f) => f.followerId === id).length,
      xp,
      level,
      awards,
      rank: db.ranks.find((r) => r.id === base.rankId) ?? null,
    };
    users.set(id, view);
    return view;
  }

  function reactions(list: Reaction[]): ReactionsView {
    const reacted = list.flatMap(({ userId, typeId }) => {
      const type = db.reactionTypes.find((t) => t.id === typeId);
      return type ? [{ user: user(userId), type }] : [];
    });
    return {
      total: reacted.length,
      byType: db.reactionTypes
        .map((type) => ({
          type,
          count: reacted.filter((entry) => entry.type.id === type.id).length,
        }))
        .filter((entry) => entry.count > 0)
        .toSorted((a, b) => b.count - a.count),
      viewerTypeId:
        reacted.find((entry) => entry.user.id === viewerId)?.type.id ?? null,
      users: reacted,
    };
  }

  function lastPost(posts: Post[]): LastPostView | null {
    const last = posts.toSorted(newest)[0];
    if (!last) return null;
    const thread = db.threads.find((t) => t.id === last.threadId) as Thread;
    return {
      postId: last.id,
      threadId: thread.id,
      threadTitle: thread.title,
      prefix: db.prefixes.find((p) => p.id === thread.prefixId) ?? null,
      createdAt: last.createdAt,
      author: user(last.authorId),
    };
  }

  function forum(id: number): ForumView {
    const cached = forums.get(id);
    if (cached) return cached;
    const category = db.categories.find((c) =>
      c.forums.some((f) => f.id === id),
    ) as Category;
    const base = category.forums.find((f) => f.id === id) as Forum;
    const threadIds = db.threads
      .filter((t) => t.forumId === id)
      .map((t) => t.id);
    const posts = db.posts.filter((p) => threadIds.includes(p.threadId));
    const view: ForumView = {
      ...base,
      categoryId: category.id,
      categoryTitle: category.title,
      tab: category.tab,
      threadCount: threadIds.length,
      postCount: posts.length,
      lastPost: lastPost(posts),
    };
    forums.set(id, view);
    return view;
  }

  function thread(id: number): ThreadView {
    const cached = threads.get(id);
    if (cached) return cached;
    const base = db.threads.find((t) => t.id === id);
    if (!base) throw new Error(`Unknown thread ${id}`);
    const posts = db.posts
      .filter((p) => p.threadId === id)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    const { slug, title, categoryTitle, tab } = forum(base.forumId);
    const view: ThreadView = {
      ...base,
      author: user(base.authorId),
      forum: { id: base.forumId, slug, title, categoryTitle, tab },
      prefix: db.prefixes.find((p) => p.id === base.prefixId) ?? null,
      highlighted: isHighlighted(base, now),
      excerpt: excerpt(posts[0].body),
      postCount: posts.length,
      replyCount: posts.length - 1,
      reactionCount: posts.reduce((sum, p) => sum + p.reactions.length, 0),
      lastPost: lastPost(posts) as LastPostView,
    };
    threads.set(id, view);
    return view;
  }

  function post(base: Post): PostView {
    const parent = db.threads.find((t) => t.id === base.threadId) as Thread;
    const siblings = db.posts
      .filter((p) => p.threadId === base.threadId)
      .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
    return {
      ...base,
      author: user(base.authorId),
      reactions: reactions(base.reactions),
      number: siblings.findIndex((p) => p.id === base.id) + 1,
      isThreadAuthor: parent.authorId === base.authorId,
      thread: {
        id: parent.id,
        title: parent.title,
        prefix: db.prefixes.find((p) => p.id === parent.prefixId) ?? null,
      },
    };
  }

  function profileComment(base: ProfileComment): ProfileCommentView {
    return {
      ...base,
      author: user(base.authorId),
      reactions: reactions(base.reactions),
    };
  }

  function profilePost(base: ProfilePost): ProfilePostView {
    return {
      ...base,
      author: user(base.authorId),
      profileUser: user(base.profileUserId),
      reactions: reactions(base.reactions),
      comments: base.comments.map(profileComment),
    };
  }

  function message(base: Message): MessageView {
    return {
      ...base,
      author: user(base.authorId),
      reactions: reactions(base.reactions),
    };
  }

  function conversation(base: Conversation, userId: number): ConversationView {
    const messages = base.messages.map(message);
    return {
      ...base,
      participants: base.participantIds.map(user),
      messages,
      lastMessage: messages[messages.length - 1],
      unread: !base.readBy.includes(userId),
    };
  }

  return {
    user,
    forum,
    thread,
    post,
    profileComment,
    profilePost,
    message,
    conversation,
  };
}

function notify(
  db: Database,
  input: {
    userId: number;
    actorId: number;
    type: NotificationType;
    text: string;
    href: string;
  },
) {
  if (input.userId === input.actorId) return;
  db.notifications.push({
    id: nextId(db.notifications),
    ...input,
    createdAt: new Date().toISOString(),
    read: false,
  });
}

function normalize(body: string) {
  return body.replace(/\r\n?/g, "\n");
}

function sameClient(a: ClientInfo, b: ClientInfo) {
  return a.browser === b.browser && a.os === b.os;
}

export async function getUsers(): Promise<UserView[]> {
  const db = await read();
  const v = views(db, null);
  return db.users.map((u) => v.user(u.id));
}

export async function getUser(username: string): Promise<UserView | null> {
  const db = await read();
  const match = db.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );
  return match ? views(db, null).user(match.id) : null;
}

export async function getUserById(id: number): Promise<UserView | null> {
  const db = await read();
  return db.users.some((u) => u.id === id) ? views(db, null).user(id) : null;
}

const LEADERBOARDS = {
  xp: (user) => user.xp,
  credits: (user) => user.credits,
  posts: (user) => user.postCount,
  reactions: (user) => user.reactionCount,
  awards: (user) => user.awards.length,
  referrals: (user) => user.referralCount,
} satisfies Record<string, (user: UserView) => number>;

export type LeaderboardKind = keyof typeof LEADERBOARDS;

export async function getLeaderboard(
  by: LeaderboardKind,
  limit: number,
): Promise<UserView[]> {
  const score = LEADERBOARDS[by];
  return (await getUsers())
    .toSorted((a, b) => score(b) - score(a))
    .slice(0, limit);
}

export async function getNewestMembers(limit: number): Promise<UserView[]> {
  return (await getUsers())
    .toSorted((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .slice(0, limit);
}

export async function getStaff(): Promise<UserView[]> {
  const roles: Role[] = ["admin", "moderator"];
  return (await getUsers())
    .filter((user) => user.role !== "member")
    .toSorted((a, b) => roles.indexOf(a.role) - roles.indexOf(b.role));
}

export async function searchMembers(query: string): Promise<UserView[]> {
  const term = query.trim().toLowerCase();
  if (!term) return [];
  return (await getUsers())
    .filter((user) => user.username.toLowerCase().includes(term))
    .toSorted((a, b) => a.username.localeCompare(b.username));
}

// Members whose birthday is today, whatever the year.
export async function getBirthdays(): Promise<UserView[]> {
  const users = await getUsers();
  const date = new Date();
  const day = [date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("-");
  return users.filter((user) => user.birthday?.slice(5) === day);
}

function standing(
  db: Database,
  user: (id: number) => UserView,
  month: Month,
): StandingEntry[] {
  const within = (date: string | null) => date !== null && inMonth(month, date);
  const reactable = [
    ...db.posts,
    ...db.profilePosts.flatMap((p) => [p, ...p.comments]),
  ];
  return db.users
    .map(({ id }) => {
      const activity = {
        posts: db.posts.filter((p) => p.authorId === id && within(p.createdAt))
          .length,
        reactions: reactable
          .filter((item) => item.authorId === id)
          .flatMap((item) => item.reactions)
          .filter((reaction) => within(reaction.createdAt)).length,
        referrals: db.users.filter(
          (u) => u.referredBy === id && within(u.referredAt),
        ).length,
      };
      return { user: user(id), ...activity, points: standingPoints(activity) };
    })
    .filter((entry) => entry.points > 0)
    .toSorted(compareStanding);
}

// The clock is read after the file, as everywhere in this module: a
// prerender must not see the current time before a request-time read.
export async function getLastMonthStanding(): Promise<{
  month: Month;
  entries: StandingEntry[];
}> {
  const db = await read();
  const month = previousMonth(monthOf(new Date()));
  return { month, entries: standing(db, views(db, null).user, month) };
}

export async function getCurrentMonthStanding(
  limit: number,
): Promise<StandingEntry[]> {
  const db = await read();
  const month = monthOf(new Date());
  return standing(db, views(db, null).user, month).slice(0, limit);
}

function isBefore(month: Month, date: string) {
  const other = monthOf(new Date(date));
  return (
    month.year < other.year ||
    (month.year === other.year && month.month < other.month)
  );
}

// Winners of complete months, newest first, back to the month the first
// member joined. A month in which nobody scored has no winner.
function winners(db: Database, limit: number): MonthWinner[] {
  const { user } = views(db, null);
  const first = db.users.map((u) => u.joinedAt).toSorted()[0];
  const found: MonthWinner[] = [];
  let month = previousMonth(monthOf(new Date()));
  while (found.length < limit && first && !isBefore(month, first)) {
    const [winner] = standing(db, user, month);
    if (winner) found.push({ ...winner, ...month });
    month = previousMonth(month);
  }
  return found;
}

// The winner of the last complete month, or null if nobody scored in it.
export async function getMemberOfTheMonth(): Promise<MonthWinner | null> {
  const db = await read();
  const month = previousMonth(monthOf(new Date()));
  const [winner] = standing(db, views(db, null).user, month);
  return winner ? { ...winner, ...month } : null;
}

// Winners of the months before the one `getMemberOfTheMonth` reports.
export async function getPastWinners(limit: number): Promise<MonthWinner[]> {
  const db = await read();
  const last = previousMonth(monthOf(new Date()));
  return winners(db, limit + 1)
    .filter((w) => w.year !== last.year || w.month !== last.month)
    .slice(0, limit);
}

export async function getCategories(tab?: ForumTab): Promise<CategoryView[]> {
  const db = await read();
  const v = views(db, null);
  return db.categories
    .filter((c) => !tab || c.tab === tab)
    .map((c) => ({ ...c, forums: c.forums.map((f) => v.forum(f.id)) }));
}

export async function getForum(id: number): Promise<ForumView | null> {
  const db = await read();
  const match = db.categories.flatMap((c) => c.forums).find((f) => f.id === id);
  return match ? views(db, null).forum(match.id) : null;
}

export async function getPrefixes(): Promise<Prefix[]> {
  return (await read()).prefixes;
}

export async function getThreads(
  forumId: number,
  { prefixId }: { prefixId?: number } = {},
): Promise<ThreadView[]> {
  const db = await read();
  const v = views(db, null);
  return db.threads
    .filter(
      (t) =>
        t.forumId === forumId &&
        (prefixId === undefined || t.prefixId === prefixId),
    )
    .map((t) => v.thread(t.id))
    .toSorted(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        lastActivity(b).localeCompare(lastActivity(a)),
    );
}

export async function getForumStats(limit = 10): Promise<ForumStats> {
  const db = await read();
  const v = views(db, null);
  const threads = db.threads.map((t) => v.thread(t.id)).toSorted(newest);
  const top = (score: (thread: ThreadView) => number) =>
    threads.toSorted((a, b) => score(b) - score(a)).slice(0, limit);
  return {
    latestPosts: threads
      .toSorted((a, b) => newest(a.lastPost, b.lastPost))
      .slice(0, limit),
    latestThreads: threads.slice(0, limit),
    mostReplied: top((thread) => thread.replyCount),
    mostReacted: top((thread) => thread.reactionCount),
    mostViewed: top((thread) => thread.views),
  };
}

export async function getThread(id: number): Promise<ThreadView | null> {
  const db = await read();
  return db.threads.some((t) => t.id === id)
    ? views(db, null).thread(id)
    : null;
}

export async function getPosts(
  threadId: number,
  viewerId: number | null,
): Promise<PostView[]> {
  const db = await read();
  const v = views(db, viewerId);
  return db.posts
    .filter((p) => p.threadId === threadId)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(v.post);
}

export async function getUserThreads(userId: number): Promise<ThreadView[]> {
  const db = await read();
  const v = views(db, null);
  return db.threads
    .filter((t) => t.authorId === userId)
    .toSorted(newest)
    .map((t) => v.thread(t.id));
}

export async function getUserPosts(
  userId: number,
  viewerId: number | null,
): Promise<PostView[]> {
  const db = await read();
  const v = views(db, viewerId);
  return db.posts
    .filter((p) => p.authorId === userId)
    .toSorted(newest)
    .map(v.post);
}

export async function getProfilePosts(
  userId: number,
  viewerId: number | null,
): Promise<ProfilePostView[]> {
  const db = await read();
  const v = views(db, viewerId);
  return db.profilePosts
    .filter((p) => p.profileUserId === userId)
    .toSorted(newest)
    .map(v.profilePost);
}

export async function getFeed(
  viewerId: number | null,
  limit = 40,
): Promise<FeedItem[]> {
  const db = await read();
  const v = views(db, viewerId);
  const followed = new Set(
    db.follows
      .filter((f) => f.followerId === viewerId)
      .map((f) => f.followingId),
  );
  const firstPostIds = new Set(
    db.threads.map(
      (t) =>
        db.posts
          .filter((p) => p.threadId === t.id)
          .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))[0].id,
    ),
  );
  const entries = [
    ...db.posts.map((post) => ({ kind: "post" as const, post })),
    ...db.profilePosts.map((post) => ({ kind: "profilePost" as const, post })),
  ]
    .toSorted((a, b) => newest(a.post, b.post))
    .slice(0, limit);

  return entries.map((entry): FeedItem => {
    const shared = {
      createdAt: entry.post.createdAt,
      author: v.user(entry.post.authorId),
      following: followed.has(entry.post.authorId),
    };
    if (entry.kind === "profilePost") {
      return {
        ...shared,
        id: `profilePost-${entry.post.id}`,
        type: "profilePost",
        profilePost: v.profilePost(entry.post),
      };
    }
    const type = firstPostIds.has(entry.post.id) ? "thread" : "post";
    return {
      ...shared,
      id: `${type}-${entry.post.id}`,
      type,
      thread: v.thread(entry.post.threadId),
      post: v.post(entry.post),
    };
  });
}

export async function getConversations(
  userId: number,
): Promise<ConversationView[]> {
  const db = await read();
  const v = views(db, userId);
  return db.conversations
    .filter((c) => c.participantIds.includes(userId))
    .map((c) => v.conversation(c, userId))
    .toSorted((a, b) => newest(a.lastMessage, b.lastMessage));
}

export async function getConversation(
  id: number,
  userId: number,
): Promise<ConversationView | null> {
  const db = await read();
  const match = db.conversations.find(
    (c) => c.id === id && c.participantIds.includes(userId),
  );
  return match ? views(db, userId).conversation(match, userId) : null;
}

export async function getNotifications(
  userId: number,
): Promise<NotificationView[]> {
  const db = await read();
  const v = views(db, null);
  return db.notifications
    .filter((n) => n.userId === userId)
    .toSorted(newest)
    .map((n) => {
      const threadId = n.href.match(/^\/threads\/(\d+)(?:[/?#]|$)/)?.[1];
      const thread = db.threads.find((t) => t.id === Number(threadId));
      return {
        ...n,
        actor: v.user(n.actorId),
        prefix: db.prefixes.find((p) => p.id === thread?.prefixId) ?? null,
      };
    });
}

export async function getUnreadCounts(userId: number): Promise<UnreadCounts> {
  const db = await read();
  return {
    conversations: db.conversations.filter(
      (c) => c.participantIds.includes(userId) && !c.readBy.includes(userId),
    ).length,
    notifications: db.notifications.filter(
      (n) => n.userId === userId && !n.read,
    ).length,
  };
}

export async function isFollowing(
  followerId: number,
  followingId: number,
): Promise<boolean> {
  const db = await read();
  return db.follows.some(
    (f) => f.followerId === followerId && f.followingId === followingId,
  );
}

export async function getFollowers(userId: number): Promise<UserView[]> {
  const db = await read();
  const v = views(db, null);
  return db.follows
    .filter((f) => f.followingId === userId)
    .map((f) => v.user(f.followerId));
}

export async function getFollowing(userId: number): Promise<UserView[]> {
  const db = await read();
  const v = views(db, null);
  return db.follows
    .filter((f) => f.followerId === userId)
    .map((f) => v.user(f.followingId));
}

export async function getReactionTypes(): Promise<ReactionType[]> {
  return (await read()).reactionTypes;
}

export async function getAwards(): Promise<AwardView[]> {
  const db = await read();
  const v = views(db, null);
  return db.awards.toSorted(bestAward).map((award) => ({
    ...award,
    holders: db.userAwards
      .filter((entry) => entry.awardId === award.id)
      .toSorted((a, b) => a.awardedAt.localeCompare(b.awardedAt))
      .map(({ userId, awardedAt }) => ({ user: v.user(userId), awardedAt })),
  }));
}

export async function getAward(id: number): Promise<AwardView | null> {
  return (await getAwards()).find((award) => award.id === id) ?? null;
}

export async function getShopItems(): Promise<ShopItem[]> {
  return (await read()).shopItems;
}

export async function getRanks(): Promise<Rank[]> {
  return (await read()).ranks.toSorted((a, b) => a.price - b.price);
}

function inventory(db: Database, userId: number): InventoryItemView[] {
  return db.inventory
    .filter((entry) => entry.userId === userId)
    .toSorted((a, b) => b.acquiredAt.localeCompare(a.acquiredAt))
    .flatMap(({ itemId, acquiredAt, quantity }) => {
      const item = db.shopItems.find((i) => i.id === itemId);
      return item ? [{ ...item, acquiredAt, quantity }] : [];
    });
}

export async function getInventory(
  userId: number,
): Promise<InventoryItemView[]> {
  return inventory(await read(), userId);
}

export async function getOwnedItems(userId: number): Promise<OwnedItems> {
  const owned: OwnedItems = {
    frame: [],
    color: [],
    threadCover: [],
    boost: [],
    permission: [],
  };
  for (const item of inventory(await read(), userId)) {
    owned[item.category].push(item);
  }
  return owned;
}

export async function getPermissions(
  userId: number,
): Promise<PermissionView[]> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  return user ? permissionsOf(db, user) : [];
}

export async function getTransactions(userId: number): Promise<Transaction[]> {
  const db = await read();
  return db.transactions.filter((t) => t.userId === userId).toSorted(newest);
}

export async function getSessions(userId: number): Promise<Session[]> {
  const db = await read();
  return db.sessions
    .filter((s) => s.userId === userId)
    .toSorted((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}

export async function createUser(input: {
  username: string;
  client: ClientInfo;
}): Promise<UserView | null> {
  const db = await read();
  const username = input.username.trim();
  const taken = db.users.some(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );
  if (!username || taken) return null;
  const id = nextId(db.users);
  const joinedAt = new Date().toISOString();
  db.users.push({
    id,
    username,
    title: null,
    role: "member",
    avatar: "",
    appearance: { accent: null, nameColor: null, frame: null, cover: null },
    rankId: null,
    donor: false,
    bio: "",
    signature: null,
    birthday: null,
    referredBy: null,
    referredAt: null,
    location: "",
    website: "",
    joinedAt,
    credits: 0,
    reputation: 0,
    vouches: 0,
    socials: {},
    lastSeen: { at: joinedAt, ...input.client },
  });
  await write(db);
  return views(db, id).user(id);
}

export async function recordSignIn(
  userId: number,
  client: ClientInfo,
): Promise<void> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return;
  const now = new Date().toISOString();
  const existing = db.sessions.find(
    (s) => s.userId === userId && sameClient(s, client),
  );
  if (existing) {
    existing.lastUsedAt = now;
  } else {
    db.sessions.push({
      id: nextId(db.sessions),
      userId,
      ...client,
      createdAt: now,
      lastUsedAt: now,
    });
  }
  user.lastSeen = { at: now, ...client };
  await write(db);
}

export async function endSession(
  userId: number,
  client: ClientInfo,
): Promise<void> {
  const db = await read();
  db.sessions = db.sessions.filter(
    (s) => s.userId !== userId || !sameClient(s, client),
  );
  await write(db);
}

export async function createThread(input: {
  forumId: number;
  authorId: number;
  title: string;
  body: string;
  prefixId?: number | null;
  client: ClientInfo;
}): Promise<ThreadView> {
  const db = await read();
  const id = nextId(db.threads);
  const createdAt = new Date().toISOString();
  db.threads.push({
    id,
    forumId: input.forumId,
    title: input.title,
    authorId: input.authorId,
    createdAt,
    pinned: false,
    views: 0,
    prefixId: db.prefixes.find((p) => p.id === input.prefixId)?.id ?? null,
    highlightedUntil: null,
    bumpedAt: null,
    cover: null,
  });
  db.posts.push({
    id: nextId(db.posts),
    threadId: id,
    authorId: input.authorId,
    body: normalize(input.body),
    createdAt,
    reactions: [],
    client: input.client,
  });
  await write(db);
  return views(db, input.authorId).thread(id);
}

export async function createPost(input: {
  threadId: number;
  authorId: number;
  body: string;
  client: ClientInfo;
}): Promise<PostView> {
  const db = await read();
  const thread = db.threads.find((t) => t.id === input.threadId) as Thread;
  const post: Post = {
    id: nextId(db.posts),
    threadId: input.threadId,
    authorId: input.authorId,
    body: normalize(input.body),
    createdAt: new Date().toISOString(),
    reactions: [],
    client: input.client,
  };
  db.posts.push(post);
  notify(db, {
    userId: thread.authorId,
    actorId: input.authorId,
    type: "reply",
    text: `replied to your thread “${thread.title}”`,
    href: `/threads/${thread.id}`,
  });
  await write(db);
  return views(db, input.authorId).post(post);
}

export async function createProfilePost(input: {
  profileUserId: number;
  authorId: number;
  body: string;
  client: ClientInfo;
}): Promise<ProfilePostView> {
  const db = await read();
  const post: ProfilePost = {
    id: nextId(db.profilePosts),
    profileUserId: input.profileUserId,
    authorId: input.authorId,
    body: normalize(input.body),
    createdAt: new Date().toISOString(),
    reactions: [],
    client: input.client,
    comments: [],
  };
  db.profilePosts.push(post);
  notify(db, {
    userId: input.profileUserId,
    actorId: input.authorId,
    type: "profile_post",
    text: "wrote on your profile",
    href: `/members/${input.profileUserId}`,
  });
  await write(db);
  return views(db, input.authorId).profilePost(post);
}

export async function createProfileComment(input: {
  profilePostId: number;
  authorId: number;
  body: string;
  client: ClientInfo;
}): Promise<ProfileCommentView> {
  const db = await read();
  const post = db.profilePosts.find(
    (p) => p.id === input.profilePostId,
  ) as ProfilePost;
  const comment: ProfileComment = {
    id: nextId(db.profilePosts.flatMap((p) => p.comments)),
    authorId: input.authorId,
    body: normalize(input.body),
    createdAt: new Date().toISOString(),
    reactions: [],
    client: input.client,
  };
  post.comments.push(comment);
  notify(db, {
    userId: post.authorId,
    actorId: input.authorId,
    type: "profile_comment",
    text: "commented on your profile post",
    href: `/members/${post.profileUserId}`,
  });
  await write(db);
  return views(db, input.authorId).profileComment(comment);
}

function findReactable(
  db: Database,
  target: ReactionTarget,
  id: number,
  userId: number,
): {
  item: { authorId: number; reactions: Reaction[] };
  what: string;
  href: string;
} | null {
  if (target === "post") {
    const item = db.posts.find((p) => p.id === id);
    const thread = db.threads.find((t) => t.id === item?.threadId);
    return item && thread
      ? {
          item,
          what: `post in “${thread.title}”`,
          href: `/threads/${thread.id}#post-${item.id}`,
        }
      : null;
  }
  if (target === "message") {
    const conversation = db.conversations.find(
      (c) =>
        c.participantIds.includes(userId) &&
        c.messages.some((m) => m.id === id),
    );
    const item = conversation?.messages.find((m) => m.id === id);
    return conversation && item
      ? {
          item,
          what: `message in “${conversation.title}”`,
          href: `/conversations/${conversation.id}`,
        }
      : null;
  }
  const post = db.profilePosts.find((p) =>
    target === "profilePost"
      ? p.id === id
      : p.comments.some((c) => c.id === id),
  );
  const item =
    target === "profilePost" ? post : post?.comments.find((c) => c.id === id);
  return post && item
    ? {
        item,
        what: target === "profilePost" ? "profile post" : "comment",
        href: `/members/${post.profileUserId}#profile-post-${post.id}`,
      }
    : null;
}

export async function setReaction(input: {
  target: ReactionTarget;
  id: number;
  userId: number;
  typeId: number | null;
}): Promise<boolean> {
  const db = await read();
  const found = findReactable(db, input.target, input.id, input.userId);
  const type = db.reactionTypes.find((t) => t.id === input.typeId);
  if (!found || found.item.authorId === input.userId) return false;
  if (input.typeId !== null && !type) return false;
  const { item, what, href } = found;
  const existing = item.reactions.find((r) => r.userId === input.userId);
  if (!type) {
    item.reactions = item.reactions.filter((r) => r.userId !== input.userId);
  } else if (existing) {
    existing.typeId = type.id;
  } else {
    item.reactions.push({
      userId: input.userId,
      typeId: type.id,
      createdAt: new Date().toISOString(),
    });
    const pending = db.notifications.some(
      (n) =>
        !n.read &&
        n.type === "reaction" &&
        n.userId === item.authorId &&
        n.actorId === input.userId &&
        n.href === href,
    );
    if (!pending) {
      notify(db, {
        userId: item.authorId,
        actorId: input.userId,
        type: "reaction",
        text: `reacted ${type.emoji} to your ${what}`,
        href,
      });
    }
  }
  await write(db);
  return true;
}

export async function purchaseItem(
  userId: number,
  itemId: number,
): Promise<PurchaseResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  const item = db.shopItems.find((i) => i.id === itemId);
  if (!user || !item) return { ok: false, error: "not_found" };
  const owned = db.inventory.find(
    (e) => e.userId === userId && e.itemId === itemId,
  );
  // Buying a consumable again adds to the stock. A permission that a rank or
  // a staff role already grants cannot be bought on top.
  const granted =
    item.effect.type === "permission" &&
    (isStaff(user) ||
      (!item.consumable && holds(db, user, item.effect.permission)));
  if ((owned && !item.consumable) || granted) {
    return { ok: false, error: "already_owned" };
  }
  if (user.credits < item.price) {
    return { ok: false, error: "insufficient_credits" };
  }
  const now = new Date().toISOString();
  user.credits -= item.price;
  if (owned) owned.quantity += 1;
  else db.inventory.push({ userId, itemId, acquiredAt: now, quantity: 1 });
  db.transactions.push({
    id: nextId(db.transactions),
    userId,
    amount: -item.price,
    reason: `Purchased ${item.name}`,
    createdAt: now,
  });
  await write(db);
  return { ok: true };
}

function unlocks(db: Database, userId: number) {
  const effects = inventory(db, userId).map((item) => item.effect);
  const user = db.users.find((u) => u.id === userId);
  const rank = db.ranks.find((r) => r.id === user?.rankId);
  return {
    frames: effects.flatMap((e) => (e.type === "frame" ? [e.frame] : [])),
    // A rank brings its own name colour and those of the ranks below it.
    nameColors: [
      ...db.ranks.flatMap((r) =>
        rank && r.price <= rank.price ? (r.headline.nameColor ?? []) : [],
      ),
      ...effects.flatMap((e) => (e.type === "nameColor" ? [e.color] : [])),
    ],
  };
}

export type Unlocks = ReturnType<typeof unlocks>;

export async function getUnlocks(userId: number): Promise<Unlocks> {
  return unlocks(await read(), userId);
}

export async function setAppearance(
  userId: number,
  patch: Partial<Appearance>,
): Promise<AppearanceResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "not_found" };
  const { accent, nameColor, frame, cover } = patch;
  const owned = unlocks(db, userId);
  if (accent !== undefined && accent !== null && !isAccent(accent)) {
    return { ok: false, error: "invalid" };
  }
  if (cover != null && !isCover(cover)) {
    return { ok: false, error: "invalid" };
  }
  if (cover != null && !holds(db, user, "profileCover")) {
    return { ok: false, error: "not_allowed" };
  }
  if (
    (nameColor != null && !owned.nameColors.includes(nameColor)) ||
    (frame != null && !owned.frames.includes(frame))
  ) {
    return { ok: false, error: "not_owned" };
  }
  user.appearance = {
    accent: accent === undefined ? user.appearance.accent : accent,
    nameColor: nameColor === undefined ? user.appearance.nameColor : nameColor,
    frame: frame === undefined ? user.appearance.frame : frame,
    cover: cover === undefined ? user.appearance.cover : cover,
  };
  await write(db);
  return { ok: true, appearance: user.appearance };
}

const DAY = 86_400_000;

// Takes one unit of a consumable out of the inventory.
function consume(db: Database, userId: number, itemId: number) {
  const owned = db.inventory.find(
    (e) => e.userId === userId && e.itemId === itemId,
  );
  if (!owned || owned.quantity < 1) return false;
  owned.quantity -= 1;
  if (owned.quantity <= 0) db.inventory.splice(db.inventory.indexOf(owned), 1);
  return true;
}

export async function applyBoost(
  userId: number,
  itemId: number,
  threadId: number,
): Promise<BoostResult> {
  const db = await read();
  const item = db.shopItems.find((i) => i.id === itemId);
  const thread = db.threads.find((t) => t.id === threadId);
  if (!item || !thread) return { ok: false, error: "not_found" };
  const { effect } = item;
  if (effect.type !== "highlight" && effect.type !== "bump") {
    return { ok: false, error: "not_found" };
  }
  if (thread.authorId !== userId) return { ok: false, error: "not_author" };
  if (!consume(db, userId, itemId)) return { ok: false, error: "not_owned" };
  const now = new Date();
  if (effect.type === "bump") {
    thread.bumpedAt = now.toISOString();
  } else {
    // A second highlight extends the one that is still running.
    const from = Math.max(
      now.getTime(),
      thread.highlightedUntil ? Date.parse(thread.highlightedUntil) : 0,
    );
    thread.highlightedUntil = new Date(from + effect.days * DAY).toISOString();
  }
  await write(db);
  return { ok: true, thread: views(db, userId).thread(threadId) };
}

// Uses one thread cover on the member's own thread, replacing the one it has.
export async function applyThreadCover(
  userId: number,
  itemId: number,
  threadId: number,
): Promise<ThreadCoverResult> {
  const db = await read();
  const item = db.shopItems.find((i) => i.id === itemId);
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread || item?.effect.type !== "threadCover") {
    return { ok: false, error: "not_found" };
  }
  if (thread.authorId !== userId) return { ok: false, error: "not_author" };
  if (!consume(db, userId, itemId)) return { ok: false, error: "not_owned" };
  thread.cover = item.effect.cover;
  await write(db);
  return { ok: true, thread: views(db, userId).thread(threadId) };
}

// The cover is not returned to the inventory.
export async function removeThreadCover(
  userId: number,
  threadId: number,
): Promise<ThreadCoverRemoval> {
  const db = await read();
  const thread = db.threads.find((t) => t.id === threadId);
  if (!thread) return { ok: false, error: "not_found" };
  if (thread.authorId !== userId) return { ok: false, error: "not_author" };
  thread.cover = null;
  await write(db);
  return { ok: true, thread: views(db, userId).thread(threadId) };
}

// An empty signature clears it.
export async function setSignature(
  userId: number,
  body: string,
): Promise<SignatureResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "not_found" };
  if (!holds(db, user, "signature")) return { ok: false, error: "not_allowed" };
  const signature = normalize(body).trim();
  if (signature.length > SIGNATURE_MAX_LENGTH) {
    return { ok: false, error: "too_long" };
  }
  if (signature.split("\n").length > SIGNATURE_MAX_LINES) {
    return { ok: false, error: "too_many_lines" };
  }
  user.signature = signature || null;
  await write(db);
  return { ok: true, signature: user.signature };
}

// An empty title goes back to the one derived from role and level.
export async function setTitle(
  userId: number,
  title: string,
): Promise<TitleResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "not_found" };
  if (!holds(db, user, "customTitle")) {
    return { ok: false, error: "not_allowed" };
  }
  const custom = title.replace(/\s+/g, " ").trim();
  if (custom.length > TITLE_MAX_LENGTH) return { ok: false, error: "too_long" };
  user.title = custom || null;
  await write(db);
  return { ok: true, title: user.title };
}

// Members spend one username change; staff change theirs freely.
export async function changeUsername(
  userId: number,
  input: string,
): Promise<UsernameResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { ok: false, error: "not_found" };
  const username = input.trim();
  if (!USERNAME_PATTERN.test(username) || username === user.username) {
    return { ok: false, error: "invalid" };
  }
  const taken = db.users.some(
    (u) =>
      u.id !== userId && u.username.toLowerCase() === username.toLowerCase(),
  );
  if (taken) return { ok: false, error: "taken" };
  const change = db.shopItems.find(
    ({ effect }) =>
      effect.type === "permission" && effect.permission === "usernameChange",
  );
  if (!isStaff(user) && !(change && consume(db, userId, change.id))) {
    return { ok: false, error: "not_allowed" };
  }
  user.username = username;
  await write(db);
  return { ok: true, username };
}

export async function purchaseRank(
  userId: number,
  rankId: number,
): Promise<RankResult> {
  const db = await read();
  const user = db.users.find((u) => u.id === userId);
  const rank = db.ranks.find((r) => r.id === rankId);
  if (!user || !rank) return { ok: false, error: "not_found" };
  const current = db.ranks.find((r) => r.id === user.rankId);
  if (current && current.price >= rank.price) {
    return { ok: false, error: "not_higher" };
  }
  const cost = rank.price - (current?.price ?? 0);
  if (user.credits < cost) return { ok: false, error: "insufficient_credits" };
  const now = new Date().toISOString();
  user.credits -= cost;
  user.rankId = rank.id;
  db.transactions.push({
    id: nextId(db.transactions),
    userId,
    amount: -cost,
    reason: `Upgraded to ${rank.name}`,
    createdAt: now,
  });
  const award = db.awards.find((a) => a.slug === rank.headline.award);
  const held = db.userAwards.some(
    (entry) => entry.userId === userId && entry.awardId === award?.id,
  );
  if (award && !held) {
    db.userAwards.push({ userId, awardId: award.id, awardedAt: now });
  }
  await write(db);
  return { ok: true };
}

export async function toggleFollow(
  followerId: number,
  followingId: number,
): Promise<boolean> {
  const db = await read();
  const index = db.follows.findIndex(
    (f) => f.followerId === followerId && f.followingId === followingId,
  );
  if (index === -1) {
    db.follows.push({ followerId, followingId });
    notify(db, {
      userId: followingId,
      actorId: followerId,
      type: "follow",
      text: "started following you",
      href: `/members/${followerId}`,
    });
  } else {
    db.follows.splice(index, 1);
  }
  await write(db);
  return index === -1;
}

export async function createConversation(input: {
  title: string;
  authorId: number;
  participantIds: number[];
  body: string;
  client: ClientInfo;
}): Promise<ConversationView> {
  const db = await read();
  const conversation: Conversation = {
    id: nextId(db.conversations),
    title: input.title,
    participantIds: [...new Set([input.authorId, ...input.participantIds])],
    messages: [
      {
        id: nextId(db.conversations.flatMap((c) => c.messages)),
        authorId: input.authorId,
        body: normalize(input.body),
        createdAt: new Date().toISOString(),
        reactions: [],
        client: input.client,
      },
    ],
    readBy: [input.authorId],
  };
  db.conversations.push(conversation);
  for (const userId of conversation.participantIds) {
    notify(db, {
      userId,
      actorId: input.authorId,
      type: "message",
      text: `started the conversation “${conversation.title}”`,
      href: `/conversations/${conversation.id}`,
    });
  }
  await write(db);
  return views(db, input.authorId).conversation(conversation, input.authorId);
}

export async function createMessage(input: {
  conversationId: number;
  authorId: number;
  body: string;
  client: ClientInfo;
}): Promise<MessageView> {
  const db = await read();
  const conversation = db.conversations.find(
    (c) => c.id === input.conversationId,
  ) as Conversation;
  const message: Message = {
    id: nextId(db.conversations.flatMap((c) => c.messages)),
    authorId: input.authorId,
    body: normalize(input.body),
    createdAt: new Date().toISOString(),
    reactions: [],
    client: input.client,
  };
  conversation.messages.push(message);
  conversation.readBy = [input.authorId];
  for (const userId of conversation.participantIds) {
    notify(db, {
      userId,
      actorId: input.authorId,
      type: "message",
      text: `sent a message in “${conversation.title}”`,
      href: `/conversations/${conversation.id}`,
    });
  }
  await write(db);
  return views(db, input.authorId).message(message);
}

export async function markConversationRead(
  id: number,
  userId: number,
): Promise<void> {
  const db = await read();
  const conversation = db.conversations.find((c) => c.id === id);
  if (!conversation || conversation.readBy.includes(userId)) return;
  conversation.readBy.push(userId);
  await write(db);
}

export async function markNotificationsRead(userId: number): Promise<void> {
  const db = await read();
  for (const notification of db.notifications) {
    if (notification.userId === userId) notification.read = true;
  }
  await write(db);
}

export type SearchResults = {
  threads: ThreadView[];
  posts: PostView[];
  users: UserView[];
};

export type SearchFilters = {
  titlesOnly?: boolean;
  member?: string;
  forumId?: number;
  prefixId?: number;
};

export async function search(
  query: string,
  viewerId: number | null,
  { titlesOnly, member, forumId, prefixId }: SearchFilters = {},
): Promise<SearchResults> {
  const term = query.trim().toLowerCase();
  if (!term) return { threads: [], posts: [], users: [] };
  const db = await read();
  const v = views(db, viewerId);
  const name = member?.trim().toLowerCase();
  // An unknown member name matches nothing rather than everything.
  const authorId = name
    ? (db.users.find((u) => u.username.toLowerCase() === name)?.id ?? 0)
    : undefined;
  const byMember = (item: { authorId: number }) =>
    authorId === undefined || item.authorId === authorId;
  const threads = db.threads.filter(
    (t) =>
      (forumId === undefined || t.forumId === forumId) &&
      (prefixId === undefined || t.prefixId === prefixId),
  );
  const threadIds = new Set(threads.map((t) => t.id));
  return {
    threads: threads
      .filter((t) => byMember(t) && t.title.toLowerCase().includes(term))
      .toSorted(newest)
      .map((t) => v.thread(t.id)),
    posts: titlesOnly
      ? []
      : db.posts
          .filter(
            (p) =>
              byMember(p) &&
              threadIds.has(p.threadId) &&
              p.body.toLowerCase().includes(term),
          )
          .toSorted(newest)
          .map(v.post),
    users: db.users
      .filter((u) => u.username.toLowerCase().includes(term))
      .map((u) => v.user(u.id)),
  };
}

// Moderation: staff take the cover off any thread. Nothing is returned to the
// author's inventory.
export async function removeThreadCoverAsStaff(
  staffId: number,
  threadId: number,
): Promise<ThreadCoverRemoval> {
  const db = await read();
  const staff = db.users.find((u) => u.id === staffId);
  const thread = db.threads.find((t) => t.id === threadId);
  if (!staff || !thread) return { ok: false, error: "not_found" };
  if (!isStaff(staff)) return { ok: false, error: "not_author" };
  thread.cover = null;
  await write(db);
  return { ok: true, thread: views(db, staffId).thread(threadId) };
}
