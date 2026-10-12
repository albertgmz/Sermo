export type NavLink = {
  label: string;
  href: string;
  match?: string[];
  highlight?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { label: "Home", href: "/" },
  { label: "Forums", href: "/forums", match: ["/threads"] },
  { label: "Members", href: "/members" },
  { label: "Upgrade", href: "/upgrade", highlight: true },
  { label: "Awards", href: "/awards" },
  { label: "Credits", href: "/credits" },
];

export function isActivePath(
  pathname: string,
  href: string,
  match: string[] = [],
) {
  if (href === "/") return pathname === "/";
  return [href, ...match].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
