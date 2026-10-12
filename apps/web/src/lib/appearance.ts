import messages from "../../messages/en/lib.json";

// English labels remain for callers awaiting their zone's translation pass.
export const ACCENTS = [
  { key: "red", label: messages.appearance.accents.red },
  { key: "orange", label: messages.appearance.accents.orange },
  { key: "amber", label: messages.appearance.accents.amber },
  { key: "emerald", label: messages.appearance.accents.emerald },
  { key: "sky", label: messages.appearance.accents.sky },
  { key: "violet", label: messages.appearance.accents.violet },
] as const;

export type AccentKey = (typeof ACCENTS)[number]["key"];

export const DEFAULT_ACCENT: AccentKey = "red";

export function isAccent(key: unknown): key is AccentKey {
  return ACCENTS.some((accent) => accent.key === key);
}

export const NAME_COLORS = {
  rose: {
    label: messages.appearance.nameColors.rose,
    text: "text-name-rose",
    dot: "bg-name-rose",
  },
  coral: {
    label: messages.appearance.nameColors.coral,
    text: "text-name-coral",
    dot: "bg-name-coral",
  },
  lime: {
    label: messages.appearance.nameColors.lime,
    text: "text-name-lime",
    dot: "bg-name-lime",
  },
  emerald: {
    label: messages.appearance.nameColors.emerald,
    text: "text-name-emerald",
    dot: "bg-name-emerald",
  },
  cyan: {
    label: messages.appearance.nameColors.cyan,
    text: "text-name-cyan",
    dot: "bg-name-cyan",
  },
  sky: {
    label: messages.appearance.nameColors.sky,
    text: "text-name-sky",
    dot: "bg-name-sky",
  },
  indigo: {
    label: messages.appearance.nameColors.indigo,
    text: "text-name-indigo",
    dot: "bg-name-indigo",
  },
  pink: {
    label: messages.appearance.nameColors.pink,
    text: "text-name-pink",
    dot: "bg-name-pink",
  },
  silver: {
    label: messages.appearance.nameColors.silver,
    text: "text-name-silver",
    dot: "bg-name-silver",
  },
  gold: {
    label: messages.appearance.nameColors.gold,
    text: "text-name-gold",
    dot: "bg-name-gold",
  },
  legendary: {
    label: messages.appearance.nameColors.legendary,
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
  { key: "island", label: messages.appearance.covers.island },
  { key: "portrait", label: messages.appearance.covers.portrait },
  { key: "horses", label: messages.appearance.covers.horses },
  { key: "oranges", label: messages.appearance.covers.oranges },
  { key: "winter", label: messages.appearance.covers.winter },
  { key: "ocean", label: messages.appearance.covers.ocean },
  { key: "street", label: messages.appearance.covers.street },
  { key: "leaves", label: messages.appearance.covers.leaves },
  { key: "pineapple", label: messages.appearance.covers.pineapple },
  { key: "valley", label: messages.appearance.covers.valley },
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
