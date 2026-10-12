export const LITE_COOKIE = "forum_lite";

export const LITE_CATEGORIES = [
  {
    key: "avatars",
    folders: ["avatars"],
    files: [],
  },
  {
    key: "frames",
    folders: ["frames"],
    files: [],
  },
  {
    key: "profileCovers",
    folders: ["covers"],
    files: [],
  },
  {
    key: "threadCovers",
    folders: ["thread-covers"],
    files: [],
  },
  {
    key: "forumArt",
    folders: ["forums"],
    files: [],
  },
  {
    key: "awards",
    folders: ["awards"],
    files: [],
  },
  {
    key: "shop",
    folders: ["shop"],
    files: [],
  },
  {
    key: "postImages",
    folders: [],
    files: [],
  },
  {
    key: "brand",
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
