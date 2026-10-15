// The slugs the web app itself reads or links to. A page with one of them shows where it is used;
// the others are offered when they do not exist yet.
//   address  Where the public site serves it besides /pages/<slug>.
export const WELL_KNOWN = [
  { slug: "terms", address: "/terms" },
  { slug: "rules", address: "/rules" },
  { slug: "privacy", address: "/privacy" },
  { slug: "legal", address: "/legal" },
  { slug: "contact", address: "/contact" },
  { slug: "cookies", address: "/cookies" },
  { slug: "upgrade-faq", address: null },
] as const;

export type WellKnownSlug = (typeof WELL_KNOWN)[number]["slug"];

export const wellKnown = (slug: string) =>
  WELL_KNOWN.find((entry) => entry.slug === slug);
