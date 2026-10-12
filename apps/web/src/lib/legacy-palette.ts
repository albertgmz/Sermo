// Adapts the JSON data to the presentation shapes in `lib/sermo/views.ts`: the
// data names its colours by key, the shapes carry them as #rrggbb. The values
// are the `--name-*`, `--prefix-*`, `--primary` and `--success` tokens of
// `globals.css`. This module goes away with the JSON data.

export const NAME_COLOR_HEX: Record<string, string> = {
  rose: "#fb7185",
  coral: "#fb923c",
  lime: "#a3e635",
  emerald: "#34d399",
  cyan: "#22d3ee",
  sky: "#60a5fa",
  indigo: "#818cf8",
  pink: "#f472b6",
  silver: "#c4c4cc",
  gold: "#eab308",
  legendary: "#a78bfa",
};

export const PREFIX_COLOR_HEX: Record<string, string> = {
  sky: "#60a5fa",
  emerald: "#34d399",
  orange: "#fb923c",
  violet: "#818cf8",
  amber: "#eab308",
  cyan: "#22d3ee",
  rose: "#fb7185",
  lime: "#a3e635",
};

export const STAFF_COLOR_HEX = {
  admin: "#dc2626",
  moderator: "#2dd4bf",
};

// A prefix with an unknown colour drew muted text; this is `--muted-foreground`.
export const FALLBACK_HEX = "#a1a1aa";
