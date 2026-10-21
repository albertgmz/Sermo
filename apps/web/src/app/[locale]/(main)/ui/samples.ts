// The sample data of the styleguide: small fixed objects in the shapes the shared components take,
// with no data layer behind them. Pictures are generated SVG data, which the components draw
// through their gates like any other picture.
import type { AwardArt } from "@/components/forum/award-icon";
import type { ForumCardData } from "@/components/forum/forum-card";
import type { LeaderboardMember } from "@/components/forum/leaderboard";
import { type Level, levelWithBounds } from "@/components/forum/level";
import type { MemberCardUser } from "@/components/forum/member-card";
import type { PermissionIconKey } from "@/components/forum/permission-icon";
import type { ReactionType } from "@/components/forum/reaction-button";
import type { ReactionPictureData } from "@/components/forum/reaction-picture";
import type { ReactionsSummary } from "@/components/forum/reaction-summary";
import type { MonthWinner, StandingEntry } from "@/components/forum/standing";
import type { ThreadCardData } from "@/components/forum/thread-hover-card";
import type { MemberBadgeView } from "@/components/forum/user-badges";
import type { ApiWallComment } from "@/components/forum/wall-comments";
import type {
  AuthorView,
  MemberView,
  PictureView,
  PrefixView,
} from "@/lib/sermo/views";

function picture(width: number, height: number, body: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// A flat gradient with a soft shape: stands for a photo.
function scene(from: string, to: string): string {
  return picture(
    400,
    200,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="400" height="200" fill="url(#g)"/><circle cx="300" cy="70" r="46" fill="#ffffff" fill-opacity="0.18"/><rect y="140" width="400" height="60" fill="#000000" fill-opacity="0.2"/>`,
  );
}

function portrait(color: string): string {
  return picture(
    100,
    100,
    `<rect width="100" height="100" fill="${color}"/><circle cx="50" cy="38" r="18" fill="#ffffff" fill-opacity="0.8"/><ellipse cx="50" cy="94" rx="32" ry="30" fill="#ffffff" fill-opacity="0.8"/>`,
  );
}

function ring(color: string): string {
  return picture(
    100,
    100,
    `<circle cx="50" cy="50" r="34" fill="none" stroke="${color}" stroke-width="7"/>`,
  );
}

function badgeArt(color: string): string {
  return picture(
    64,
    64,
    `<rect width="64" height="64" fill="${color}"/><path d="M32 12l6 14 15 1-11 10 4 15-14-8-14 8 4-15-11-10 15-1z" fill="#ffffff" fill-opacity="0.85"/>`,
  );
}

const FRAME = { width: 150, left: -25, top: -25, scale: 76 };

function member(
  id: number,
  username: string,
  extra: Partial<MemberView> = {},
): MemberView {
  return {
    id,
    username,
    avatar: null,
    frame: null,
    nameColor: null,
    nameIcon: null,
    title: "Member",
    badges: [],
    level: 1,
    restricted: false,
    ...extra,
  };
}

export const ADMIN = member(1, "ada", {
  avatar: { url: portrait("#7c3aed"), smallUrl: portrait("#7c3aed") },
  nameColor: "#dc2626",
  title: "Administrator",
  badges: [{ label: "Admin", color: "#dc2626", style: "solid" }],
  level: 6,
});

export const MODERATOR = member(2, "juno", {
  avatar: { url: portrait("#0d9488"), smallUrl: portrait("#0d9488") },
  nameColor: "#2dd4bf",
  title: "Moderator",
  badges: [{ label: "Mod", color: "#2dd4bf", style: "tint" }],
  level: 4,
});

export const MEMBER = member(3, "marlowe", {
  avatar: { url: portrait("#ea580c"), smallUrl: portrait("#ea580c") },
  title: "Senior member",
  badges: [
    { label: "Gold", color: "#eab308", style: "outline" },
    { label: "Donor", color: "#fb7185", style: "heart" },
  ],
  level: 3,
});

export const FRAMED: MemberView = {
  ...member(4, "kestrel", {
    avatar: { url: portrait("#2563eb"), smallUrl: portrait("#2563eb") },
    nameColor: "#60a5fa",
    level: 2,
  }),
  frame: { url: ring("#eab308"), placement: FRAME },
};

export const NEWCOMER = member(5, "tobi");

export const GUEST = member(0, "guest", { title: "Guest" });

export const MEMBERS = [ADMIN, MODERATOR, MEMBER, FRAMED, NEWCOMER];

export const FRAME_OF_GUEST = { url: ring("#a78bfa"), placement: FRAME };

export const BADGES: MemberBadgeView[] = [
  { label: "Admin", color: "#dc2626", style: "solid" },
  { label: "Mod", color: "#2dd4bf", style: "tint" },
  { label: "Gold", color: "#eab308", style: "outline" },
  { label: "Donor", color: "#fb7185", style: "heart" },
  { label: "Group", color: null, style: "" },
];

// Colours a member may give their name.
export const NAME_COLORS = [
  { label: "Rose", color: "#fb7185" },
  { label: "Coral", color: "#fb923c" },
  { label: "Lime", color: "#a3e635" },
  { label: "Emerald", color: "#34d399" },
  { label: "Sky", color: "#60a5fa" },
  { label: "Indigo", color: "#818cf8" },
  { label: "Gold", color: "#eab308" },
  { label: "Legendary", color: "#a78bfa" },
];

// Icons a member may wear beside their name, and the side they chose.
export const NAME_ICONS = [
  { label: "star before", icon: "star", position: "before", color: null },
  { label: "heart after", icon: "heart", position: "after", color: null },
  {
    label: "crown in gold",
    icon: "crown",
    position: "before",
    color: "#eab308",
  },
  {
    label: "flame in coral",
    icon: "flame",
    position: "after",
    color: "#fb923c",
  },
] as const;

// The accents a site may offer: the colour and the text on it.
export const ACCENTS = [
  { label: "Red", color: "#dc2626", foreground: "#fafafa" },
  { label: "Orange", color: "#ea580c", foreground: "#fafafa" },
  { label: "Amber", color: "#eab308", foreground: "#18181b" },
  { label: "Emerald", color: "#059669", foreground: "#fafafa" },
  { label: "Sky", color: "#0284c7", foreground: "#fafafa" },
  { label: "Violet", color: "#7c3aed", foreground: "#fafafa" },
];

export const PREFIXES: PrefixView[] = [
  { id: 1, label: "Question", color: "#60a5fa", icon: "circle-help" },
  { id: 2, label: "Solved", color: "#34d399", icon: "circle-check" },
  { id: 3, label: "Guide", color: "#fb923c", icon: "book-open" },
  { id: 4, label: "News", color: "#818cf8", icon: "newspaper" },
  { id: 5, label: "Sale", color: "#eab308", icon: "shopping-cart" },
];

export const PERMISSION_ICONS: { icon: PermissionIconKey; label: string }[] = [
  { icon: "signature", label: "Signature" },
  { icon: "image", label: "Profile cover" },
  { icon: "tag", label: "Custom title" },
  { icon: "award", label: "Extra award slot" },
  { icon: "at-sign", label: "Username change" },
];

export const REACTION_TYPES: ReactionType[] = [
  { id: 1, key: "1", label: "Like", emoji: "👍", picture: null },
  { id: 2, key: "2", label: "Love", emoji: "❤️", picture: null },
  { id: 3, key: "3", label: "Laugh", emoji: "😂", picture: null },
  { id: 4, key: "4", label: "Wow", emoji: "😮", picture: null },
];

// A picker where the viewer has not unlocked a reaction yet: greyed with a padlock and the hint
// the backend phrases from the reaction's rule.
export const LOCKED_REACTION_TYPES: ReactionType[] = [
  ...REACTION_TYPES.slice(0, 3),
  {
    id: 5,
    key: "5",
    label: "Fire",
    emoji: "🔥",
    picture: null,
    locked: "Unlocks with: Post count: 500 or more",
  },
  {
    id: 6,
    key: "6",
    label: "Crown",
    emoji: "👑",
    picture: null,
    locked: "Unlocks with: Member of VIP",
  },
];

// Reaction pictures as the backend would hand them (sealed by hand: the styleguide has no backend,
// and the page checks LITE itself before using them): a plain image and a sprite sheet of four
// 32 x 32 frames (a dot that grows). The page checks LITE before using them, as the real pages do.
const REACTION_STILL = picture(
  64,
  64,
  `<circle cx="32" cy="32" r="26" fill="#d97706"/><path d="M32 14l5 12 13 1-10 9 3 13-11-7-11 7 3-13-10-9 13-1z" fill="#ffffff" fill-opacity="0.9"/>`,
);
const REACTION_SPRITE = picture(
  128,
  32,
  [8, 11, 14, 11]
    .map(
      (radius, frame) =>
        `<circle cx="${frame * 32 + 16}" cy="16" r="${radius}" fill="#0d9488"/>`,
    )
    .join(""),
);
export const REACTION_PICTURE_TYPES: ReactionType[] = [
  {
    id: 5,
    key: "5",
    label: "Star",
    emoji: "⭐",
    picture: { url: REACTION_STILL, frames: null } as ReactionPictureData,
  },
  {
    id: 6,
    key: "6",
    label: "Pulse",
    emoji: "💚",
    picture: {
      url: REACTION_SPRITE,
      frames: { width: 32, height: 32, count: 4, columns: 4 },
    } as ReactionPictureData,
  },
];

export const REACTIONS: ReactionsSummary = {
  total: 7,
  byType: [
    { type: REACTION_TYPES[0], count: 4 },
    { type: REACTION_TYPES[1], count: 2 },
    { type: REACTION_TYPES[2], count: 1 },
  ],
};

// Who reacted, for the list in the popover of a summary.
export const REACTION_USERS = [
  { user: ADMIN, type: REACTION_TYPES[0] },
  { user: MODERATOR, type: REACTION_TYPES[1] },
  { user: MEMBER, type: REACTION_TYPES[0] },
];

// A picture is the backdrop of an award's card, never part of its round icon.
export const AWARDS: (AwardArt & { id: number; image?: { url: string } })[] = [
  { id: 1, name: "First post", icon: "message-circle", tier: "bronze" },
  { id: 2, name: "Helping hand", icon: "life-buoy", tier: "silver" },
  { id: 3, name: "Veteran", icon: "shield", tier: "gold" },
  { id: 4, name: "Hall of fame", icon: "crown", tier: "legendary" },
  {
    id: 5,
    name: "Founder",
    icon: "star",
    tier: "gold",
    image: { url: badgeArt("#b45309") },
  },
  {
    id: 6,
    name: "Bug hunter",
    icon: "bug",
    tier: "silver",
    image: { url: badgeArt("#0f766e") },
  },
];

// A level with its bounds, and one half way through its bar.
export const LEVEL_START: Level = levelWithBounds(2, 100, 100, 300);
export const LEVEL_HALF: Level = levelWithBounds(4, 800, 600, 1000);
export const LEVEL_NEW: Level = levelWithBounds(1, 20, 0, 100);

export const COVERS: { label: string; picture: PictureView }[] = [
  { label: "Dusk", picture: { url: scene("#7c3aed", "#0f172a") } },
  { label: "Coast", picture: { url: scene("#0ea5e9", "#134e4a") } },
  { label: "Embers", picture: { url: scene("#f97316", "#7f1d1d") } },
];

export const COVERED_CARD: MemberCardUser = {
  card: ADMIN,
  createdAt: "2025-03-14T10:00:00.000Z",
  postCount: 1280,
  reactionScore: 940,
  cover: COVERS[0].picture,
  awardXp: 800,
  level: { currentLevelXp: 600, nextLevelXp: 1000 },
  awardSlots: 5,
  awards: AWARDS.slice(0, 4),
};

// The author of a post, as threads and conversations give it to the postbit.
export const SAMPLE_AUTHOR: AuthorView = {
  member: {
    ...MEMBER,
    title: "Senior member and keeper of the long, long thread titles",
  },
  cover: COVERS[0].picture,
  joinedAt: "2025-03-14T10:00:00.000Z",
  postCount: 1280,
  reactionScore: 940,
  xp: 800,
  currentLevelXp: 600,
  nextLevelXp: 1000,
  awards: AWARDS.slice(0, 4),
  signatureHtml: "<p>Read the pinned post first.</p>",
};

export const PLAIN_AUTHOR: AuthorView = {
  member: NEWCOMER,
  cover: null,
  joinedAt: "2026-06-02T08:30:00.000Z",
  postCount: 12,
  reactionScore: 3,
  xp: 20,
  currentLevelXp: 0,
  nextLevelXp: 100,
  awards: [],
  signatureHtml: null,
};

// A member whose profile the viewer may not open: no facts are drawn.
export const RESTRICTED_AUTHOR: AuthorView = {
  ...PLAIN_AUTHOR,
  member: { ...NEWCOMER, username: "reserved", restricted: true },
  joinedAt: "1970-01-01T00:00:00.000Z",
};

export const PLAIN_CARD: MemberCardUser = {
  card: NEWCOMER,
  createdAt: "2026-06-02T08:30:00.000Z",
  postCount: 12,
  reactionScore: 3,
  awardCount: 2,
};

export const LEADERS: LeaderboardMember[] = MEMBERS.map((card, index) => ({
  card,
  awardXp: 2400 - index * 380,
  credits: 5200 - index * 900,
  postCount: 640 - index * 110,
  reactionScore: 410 - index * 70,
  referralCount: 9 - index,
  awardCount: 8 - index,
}));

export const STANDING: StandingEntry[] = MEMBERS.slice(0, 3).map(
  (card, index) => {
    const posts = 40 - index * 12;
    const reactions = 120 - index * 40;
    const referrals = 2 - Math.min(index, 2);
    return {
      card,
      posts,
      reactions,
      referrals,
      points: posts + reactions / 10 + referrals * 20,
    };
  },
);

export const WINNERS: MonthWinner[] = [
  { ...STANDING[0], year: 2026, month: 9 },
  { ...STANDING[1], year: 2026, month: 8 },
  { ...STANDING[2], year: 2026, month: 7 },
];

export const FORUMS: (ForumCardData & { description: string })[] = [
  {
    id: 1,
    title: "Announcements",
    description: "News from the staff.",
    icon: "megaphone",
    image: scene("#7c3aed", "#1e1b4b"),
    isNew: true,
    threadCount: 24,
    lastPost: {
      threadId: 1,
      threadTitle: "Welcome to the forum",
      prefix: PREFIXES[3],
      createdAt: "2026-10-01T09:00:00.000Z",
      author: { username: ADMIN.username, member: ADMIN },
    },
  },
  {
    id: 2,
    title: "General discussion",
    description: "Talk about anything.",
    icon: "messages-square",
    image: scene("#0ea5e9", "#164e63"),
    subforums: [{ id: 3, title: "Introductions" }, { title: "Off topic" }],
    threadCount: 1310,
    lastPost: {
      threadId: 2,
      threadTitle: "What are you reading?",
      prefix: PREFIXES[0],
      createdAt: "2026-10-10T18:20:00.000Z",
      author: { username: MEMBER.username, member: MEMBER },
    },
  },
  {
    id: 4,
    title: "Marketplace",
    description: "Buy, sell and trade.",
    icon: "store",
    image: null,
    threadCount: 0,
    lastPost: null,
  },
];

export const THREADS: ThreadCardData[] = [
  {
    id: 2,
    title: "What are you reading?",
    prefix: PREFIXES[0],
    excerpt:
      "I just finished a long novel and I am looking for something shorter next. What would you suggest?",
    createdAt: "2026-10-09T12:00:00.000Z",
    views: 1840,
    replyCount: 23,
    coverPicture: COVERS[1].picture,
    forum: { id: 2, title: "General discussion" },
    author: { member: MEMBER },
    lastPost: {
      createdAt: "2026-10-10T18:20:00.000Z",
      author: { member: MODERATOR },
    },
  },
  {
    id: 1,
    title: "Welcome to the forum",
    prefix: null,
    excerpt: "Read the rules before you post, and say hello.",
    createdAt: "2026-10-01T09:00:00.000Z",
    views: 5200,
    replyCount: 61,
    coverPicture: null,
    forum: { id: 1, title: "Announcements" },
    author: { member: ADMIN },
    lastPost: {
      createdAt: "2026-10-08T07:45:00.000Z",
      author: { member: NEWCOMER },
    },
  },
];

export const SAMPLE_DATE = "2026-10-01T09:00:00.000Z";

// Comments of a wall post, oldest first, as the backend gives them.
export const SAMPLE_WALL_COMMENTS: ApiWallComment[] = [
  { author: ADMIN, bodyHtml: "<p>Welcome aboard.</p>", state: "visible" },
  {
    author: MODERATOR,
    bodyHtml: "<p>This one is waiting for a moderator.</p>",
    state: "moderated",
  },
].map(({ author, bodyHtml, state }, index) => ({
  id: index + 1,
  profilePostId: 1,
  author: { id: author.id, username: author.username },
  state: state as ApiWallComment["state"],
  createdAt: SAMPLE_DATE,
  editedAt: null,
  bodyHtml,
  attachmentCount: 0,
  attachments: [],
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: false,
  canDelete: false,
  canReport: true,
}));

export const NOTIFICATIONS = [
  {
    type: "thread.watched",
    contentType: "post",
    actors: [MODERATOR],
    actorCount: 1,
    contentTitle: "What are you reading?",
    emoji: "",
    reaction: "",
  },
  {
    type: "content.reaction",
    contentType: "post",
    actors: [MEMBER, ADMIN],
    actorCount: 4,
    contentTitle: "Welcome to the forum",
    emoji: "👍",
    reaction: "Like",
  },
  {
    type: "member.followed",
    contentType: "user",
    actors: [MEMBER],
    actorCount: 1,
    contentTitle: null,
    emoji: "",
    reaction: "",
  },
].map(({ emoji, reaction, ...item }, id) => ({
  item: { ...item, id, data: {}, createdAt: SAMPLE_DATE, read: id > 0 },
  href: id === 0 ? "/threads/2" : "/ui",
  emoji,
  reaction,
}));

export const CONVERSATIONS = [
  { title: "Sample conversation", participantCount: 2 },
  { title: "Group conversation", participantCount: 3 },
].map((item, id) => ({
  ...item,
  id,
  isUnread: id === 0,
  lastMessage: {
    messageId: id + 1,
    sentAt: SAMPLE_DATE,
    user: { id: MODERATOR.id, username: MODERATOR.username },
  },
}));

export function memberOf(id: number): MemberView {
  return MEMBERS.find((entry) => entry.id === id) ?? ADMIN;
}

export const SAMPLE_COUNTS = {
  postCount: 1280,
  reactionCount: 940,
  followerCount: 312,
  reputation: 1210,
  credits: 5200,
  referralCount: 9,
};

// What the viewer can do about a member, as the postbit actions draw it.
export const RELATION = {
  notFollowing: { following: false, canFollow: true, canMessage: true },
  following: { following: true, canFollow: true, canMessage: true },
  messageOnly: { following: false, canFollow: false, canMessage: true },
  none: { following: false, canFollow: false, canMessage: false },
};
