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
  try {
    value = value === undefined ? undefined : decodeURIComponent(value);
  } catch {
    // Malformed cookies must not interrupt rendering or tab synchronization.
  }
  const tokens = new Set(value?.split("."));
  return {
    master: tokens.has("all") || value === "1",
    blocked: LITE_CATEGORIES.filter(({ key }) => tokens.has(key)).map(
      ({ key }) => key,
    ),
  };
}

export function serializeLiteCookie(state: LiteState): string {
  const selected = LITE_CATEGORIES.filter(({ key }) =>
    state.blocked.includes(key),
  )
    .map(({ key }) => key)
    .join(".");
  return [state.master ? "all" : "", selected].filter(Boolean).join(".");
}

// Use the last occurrence, matching the server's request cookie semantics.
export function parseLiteCookieHeader(header: string): LiteState {
  let value: string | undefined;
  for (const cookie of header.split(";")) {
    const entry = cookie.trim();
    if (entry === LITE_COOKIE) value = "";
    if (entry.startsWith(`${LITE_COOKIE}=`)) {
      const raw = entry.slice(LITE_COOKIE.length + 1);
      try {
        decodeURIComponent(raw);
        value = raw;
      } catch {
        // Next ignores a malformed occurrence rather than replacing a valid one.
      }
    }
  }
  return parseLiteCookie(value);
}

export function updateLiteState(
  current: LiteState,
  mode: FormDataEntryValue | null,
  categories: FormDataEntryValue[],
): LiteState | null {
  if (mode !== "all" && mode !== "custom" && mode !== "off") return null;
  return {
    master: mode === "all",
    blocked:
      mode === "custom"
        ? LITE_CATEGORIES.filter(({ key }) => categories.includes(key)).map(
            ({ key }) => key,
          )
        : current.blocked,
  };
}

export function blocks(state: LiteState, category: LiteCategory): boolean {
  return state.master || state.blocked.includes(category);
}
