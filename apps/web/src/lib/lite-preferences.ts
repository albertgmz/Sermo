import type { FileMetadata } from "@sermo/core/contracts";
import type * as z from "zod";

export const LITE_COOKIE = "forum_lite";

// The categories a visitor can switch off. A backend picture belongs to the category of its file
// purpose (`liteCategoryOfPurpose`); a purpose missing here is a compile error below.
export const LITE_CATEGORIES = [
  {
    key: "avatars",
    purposes: ["avatar"],
  },
  {
    key: "frames",
    purposes: ["frame"],
  },
  {
    key: "profileCovers",
    purposes: ["cover", "cover_preset"],
  },
  {
    key: "threadCovers",
    purposes: ["thread_cover"],
  },
  {
    key: "forumArt",
    purposes: ["node_icon", "node_cover"],
  },
  {
    key: "awards",
    purposes: ["award_image"],
  },
  {
    key: "shop",
    purposes: ["shop_image"],
  },
  {
    key: "postImages",
    purposes: ["attachment"],
  },
  {
    key: "brand",
    purposes: ["site_logo", "site_icon", "site_backdrop"],
  },
] as const;

export type LiteCategory = (typeof LITE_CATEGORIES)[number]["key"];

// The backend's file purposes; a purpose missing from the registry is a compile error here.
export type FilePurpose = z.infer<typeof FileMetadata>["purpose"];

// Backend pictures are addressed by id, so their category comes from the purpose of the file.
export function liteCategoryOfPurpose(purpose: FilePurpose): LiteCategory {
  for (const category of LITE_CATEGORIES)
    if ((category.purposes as readonly string[]).includes(purpose))
      return category.key;
  throw new Error(`File purpose "${purpose}" belongs to no LITE category.`);
}

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

// The settings form submits its whole selection with every save, so for it the
// submitted categories are stored whatever the mode. The avatar-menu toggle
// submits only a mode and keeps the stored selection.
export function updateLiteState(
  current: LiteState,
  mode: FormDataEntryValue | null,
  categories: FormDataEntryValue[],
  fromSettings = false,
): LiteState | null {
  if (mode !== "all" && mode !== "custom" && mode !== "off") return null;
  return {
    master: mode === "all",
    blocked:
      mode === "custom" || (fromSettings && mode === "all")
        ? LITE_CATEGORIES.filter(({ key }) => categories.includes(key)).map(
            ({ key }) => key,
          )
        : current.blocked,
  };
}

export function blocks(state: LiteState, category: LiteCategory): boolean {
  return state.master || state.blocked.includes(category);
}
