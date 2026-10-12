import { CatalogImageKind, PaletteKind } from "@sermo/core/contracts";

// The six catalogs: the screen each lives on, and the file purpose its picture is uploaded with.
// Shared by the pages and the actions (a form names its kind, and an action checks the name
// against the contract's list before using it).

export const IMAGE_KINDS = {
  frame: {
    path: "/admin/appearance/frames",
    purpose: "frame",
    key: "frames",
  },
  profile_cover: {
    path: "/admin/appearance/covers",
    purpose: "cover_preset",
    key: "covers",
  },
  thread_cover: {
    path: "/admin/appearance/thread-covers",
    purpose: "thread_cover",
    key: "threadCovers",
  },
} as const satisfies Record<
  (typeof CatalogImageKind.options)[number],
  {
    path: string;
    purpose: string;
    key: string;
  }
>;

export const PALETTE_KINDS = {
  accent: { path: "/admin/appearance/accents", key: "accents" },
  name: { path: "/admin/appearance/name-colors", key: "nameColors" },
  prefix: { path: "/admin/appearance/prefix-colors", key: "prefixColors" },
} as const satisfies Record<
  (typeof PaletteKind.options)[number],
  { path: string; key: string }
>;

export type ImageKind = keyof typeof IMAGE_KINDS;
export type PaletteKindName = keyof typeof PALETTE_KINDS;

export const imageKind = (value: unknown): ImageKind | null => {
  const parsed = CatalogImageKind.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export const paletteKind = (value: unknown): PaletteKindName | null => {
  const parsed = PaletteKind.safeParse(value);
  return parsed.success ? parsed.data : null;
};
