import type { PermissionKey } from "@/lib/permissions";

export type Role = "admin" | "moderator" | "member";

export type ForumTab = "general" | "market" | "money";

export type Socials = {
  discord?: string;
  telegram?: string;
  x?: string;
};

export type Browser =
  | "chrome"
  | "firefox"
  | "safari"
  | "edge"
  | "opera"
  | "other";

export type Os = "windows" | "macos" | "linux" | "android" | "ios" | "other";

export type ClientInfo = {
  browser: Browser;
  os: Os;
};

export type LastSeen = ClientInfo & {
  at: string;
};

export type Session = ClientInfo & {
  id: number;
  userId: number;
  createdAt: string;
  lastUsedAt: string;
};

export type ReactionType = {
  id: number;
  key: string;
  label: string;
  emoji: string;
};

export type Reaction = {
  userId: number;
  typeId: number;
  createdAt: string;
};

export type AwardTier = "bronze" | "silver" | "gold" | "legendary";

export type Award = {
  id: number;
  slug: string;
  name: string;
  description: string;
  icon: string;
  tier: AwardTier;
  xp: number;
  image: string;
};

export type UserAward = {
  userId: number;
  awardId: number;
  awardedAt: string;
};

export type ShopCategory =
  | "frame"
  | "color"
  | "threadCover"
  | "boost"
  | "permission";

export type ShopEffect =
  | { type: "frame"; frame: string }
  | { type: "nameColor"; color: string }
  | { type: "threadCover"; cover: string }
  | { type: "highlight"; days: number }
  | { type: "bump" }
  | { type: "permission"; permission: PermissionKey };

export type ShopItem = {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: ShopCategory;
  price: number;
  image: string;
  // Used up when applied, so it can be bought again and is held in a quantity.
  consumable: boolean;
  effect: ShopEffect;
};

export type InventoryItem = {
  userId: number;
  itemId: number;
  acquiredAt: string;
  quantity: number;
};

export type Appearance = {
  accent: string | null;
  nameColor: string | null;
  frame: string | null;
  // A photo from the profile gallery; needs the profileCover permission.
  cover: string | null;
};

export type RankPerk = {
  label: string;
  included: boolean;
};

export type Rank = {
  id: number;
  slug: string;
  name: string;
  price: number;
  perks: RankPerk[];
  // Everything the rank grants, including what cheaper ranks grant.
  permissions: PermissionKey[];
  headline: {
    nameColor?: string;
    award?: string;
  };
};

export type Prefix = {
  id: number;
  key: string;
  label: string;
  color: string;
  icon: string;
};

export type Transaction = {
  id: number;
  userId: number;
  amount: number;
  reason: string;
  createdAt: string;
};

export type User = {
  id: number;
  username: string;
  // A custom title; null shows the one derived from role and level.
  title: string | null;
  role: Role;
  avatar: string;
  appearance: Appearance;
  rankId: number | null;
  donor: boolean;
  bio: string;
  // Markdown.
  signature: string | null;
  // YYYY-MM-DD.
  birthday: string | null;
  referredBy: number | null;
  referredAt: string | null;
  location: string;
  website: string;
  joinedAt: string;
  credits: number;
  reputation: number;
  vouches: number;
  socials: Socials;
  lastSeen: LastSeen;
};

export type Subforum = {
  title: string;
};

export type Forum = {
  id: number;
  slug: string;
  title: string;
  description: string;
  icon: string;
  image: string;
  isNew?: boolean;
  subforums?: Subforum[];
};

export type Category = {
  id: number;
  title: string;
  tab: ForumTab;
  forums: Forum[];
};

export type Thread = {
  id: number;
  forumId: number;
  title: string;
  authorId: number;
  createdAt: string;
  pinned: boolean;
  views: number;
  prefixId: number | null;
  highlightedUntil: string | null;
  bumpedAt: string | null;
  // Key of a photo in /public/thread-covers.
  cover: string | null;
};

export type Post = {
  id: number;
  threadId: number;
  authorId: number;
  body: string;
  createdAt: string;
  reactions: Reaction[];
  client: ClientInfo;
};

export type ProfileComment = {
  id: number;
  authorId: number;
  body: string;
  createdAt: string;
  reactions: Reaction[];
  client: ClientInfo;
};

export type ProfilePost = {
  id: number;
  profileUserId: number;
  authorId: number;
  body: string;
  createdAt: string;
  reactions: Reaction[];
  client: ClientInfo;
  comments: ProfileComment[];
};

export type Message = {
  id: number;
  authorId: number;
  body: string;
  createdAt: string;
  reactions: Reaction[];
  client: ClientInfo;
};

export type Conversation = {
  id: number;
  title: string;
  participantIds: number[];
  messages: Message[];
  readBy: number[];
};

export type NotificationType =
  | "reply"
  | "reaction"
  | "follow"
  | "profile_post"
  | "profile_comment"
  | "message";

export type Notification = {
  id: number;
  userId: number;
  type: NotificationType;
  actorId: number;
  text: string;
  href: string;
  createdAt: string;
  read: boolean;
};

export type Follow = {
  followerId: number;
  followingId: number;
};

export type Database = {
  users: User[];
  categories: Category[];
  threads: Thread[];
  posts: Post[];
  profilePosts: ProfilePost[];
  conversations: Conversation[];
  notifications: Notification[];
  follows: Follow[];
  reactionTypes: ReactionType[];
  awards: Award[];
  userAwards: UserAward[];
  shopItems: ShopItem[];
  ranks: Rank[];
  prefixes: Prefix[];
  inventory: InventoryItem[];
  transactions: Transaction[];
  sessions: Session[];
};
