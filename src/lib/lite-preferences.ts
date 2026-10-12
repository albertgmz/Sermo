export const LITE_COOKIE = "forum_lite";

export const LITE_CATEGORIES = [
  {
    key: "avatars",
    label: "Avatars",
    description: "Member profile pictures.",
    folders: ["avatars"],
    files: [],
  },
  {
    key: "frames",
    label: "Avatar frames",
    description: "Decorative frames around member pictures.",
    folders: ["frames"],
    files: [],
  },
  {
    key: "profileCovers",
    label: "Profile covers",
    description: "Cover pictures on profiles and member cards.",
    folders: ["covers"],
    files: [],
  },
  {
    key: "threadCovers",
    label: "Thread covers",
    description: "Cover pictures on threads and their previews.",
    folders: ["thread-covers"],
    files: [],
  },
  {
    key: "forumArt",
    label: "Forum pictures",
    description: "Artwork on forum cards.",
    folders: ["forums"],
    files: [],
  },
  {
    key: "awards",
    label: "Awards",
    description: "Award artwork and award glyphs.",
    folders: ["awards"],
    files: [],
  },
  {
    key: "shop",
    label: "Shop artwork",
    description: "Shop item artwork and shop glyphs.",
    folders: ["shop"],
    files: [],
  },
  {
    key: "postImages",
    label: "Content pictures",
    description: "Pictures in posts, signatures, messages and editor previews.",
    folders: [],
    files: [],
  },
  {
    key: "brand",
    label: "Brand artwork",
    description: "The logo, site icon and decorative page artwork.",
    folders: [],
    files: ["logo.svg", "icon.svg"],
  },
] as const;

export type LiteCategory = (typeof LITE_CATEGORIES)[number]["key"];

export type LiteState = {
  master: boolean;
  blocked: LiteCategory[];
};

export function parseLiteCookie(value?: string): LiteState {
  const tokens = new Set(value?.split("."));
  return {
    master: value === "all" || value === "1",
    blocked: LITE_CATEGORIES.filter(({ key }) => tokens.has(key)).map(
      ({ key }) => key,
    ),
  };
}

export function serializeLiteCookie(state: LiteState): string {
  if (state.master) return "all";
  return LITE_CATEGORIES.filter(({ key }) => state.blocked.includes(key))
    .map(({ key }) => key)
    .join(".");
}

export function blocks(state: LiteState, category: LiteCategory): boolean {
  return state.master || state.blocked.includes(category);
}
