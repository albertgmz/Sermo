export const ACCENTS = [
  { key: "red", label: "Red" },
  { key: "orange", label: "Orange" },
  { key: "amber", label: "Amber" },
  { key: "emerald", label: "Emerald" },
  { key: "sky", label: "Sky" },
  { key: "violet", label: "Violet" },
] as const;

export type AccentKey = (typeof ACCENTS)[number]["key"];

export const DEFAULT_ACCENT: AccentKey = "red";

export function isAccent(key: unknown): key is AccentKey {
  return ACCENTS.some((accent) => accent.key === key);
}

export const NAME_COLORS = {
  rose: { label: "Rose", text: "text-name-rose", dot: "bg-name-rose" },
  coral: { label: "Coral", text: "text-name-coral", dot: "bg-name-coral" },
  lime: { label: "Lime", text: "text-name-lime", dot: "bg-name-lime" },
  emerald: {
    label: "Emerald",
    text: "text-name-emerald",
    dot: "bg-name-emerald",
  },
  cyan: { label: "Cyan", text: "text-name-cyan", dot: "bg-name-cyan" },
  sky: { label: "Sky", text: "text-name-sky", dot: "bg-name-sky" },
  indigo: { label: "Indigo", text: "text-name-indigo", dot: "bg-name-indigo" },
  pink: { label: "Pink", text: "text-name-pink", dot: "bg-name-pink" },
  silver: { label: "Silver", text: "text-name-silver", dot: "bg-name-silver" },
  gold: { label: "Gold", text: "text-name-gold", dot: "bg-name-gold" },
  legendary: {
    label: "Legendary",
    text: "text-name-legendary",
    dot: "bg-name-legendary",
  },
} as const;

export type NameColorKey = keyof typeof NAME_COLORS;

export function nameColor(key: string | null | undefined) {
  return key && key in NAME_COLORS ? NAME_COLORS[key as NameColorKey] : null;
}

// The profile gallery: open to every member who holds the profileCover permission.
export const COVERS = [
  { key: "island", label: "Island" },
  { key: "portrait", label: "Portrait" },
  { key: "horses", label: "Horses" },
  { key: "oranges", label: "Orange tree" },
  { key: "winter", label: "Winter road" },
  { key: "ocean", label: "Ocean" },
  { key: "street", label: "City street" },
  { key: "leaves", label: "Autumn leaves" },
  { key: "pineapple", label: "Pineapple" },
  { key: "valley", label: "Valley" },
] as const;

export type CoverKey = (typeof COVERS)[number]["key"];

export function isCover(key: unknown): key is CoverKey {
  return COVERS.some((cover) => cover.key === key);
}

export function coverSrc(cover: string): string {
  return `/covers/${cover}.jpg`;
}

export function threadCoverSrc(cover: string): string {
  return `/thread-covers/${cover}.jpg`;
}
