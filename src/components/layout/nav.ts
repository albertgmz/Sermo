export type NavLink = {
  label:
    | "home"
    | "forums"
    | "members"
    | "upgrade"
    | "awards"
    | "credits"
    | "components";
  href: string;
  match?: string[];
  highlight?: boolean;
};

export const NAV_LINKS: NavLink[] = [
  { label: "home", href: "/" },
  { label: "forums", href: "/forums", match: ["/threads"] },
  { label: "members", href: "/members" },
  { label: "upgrade", href: "/upgrade", highlight: true },
  { label: "awards", href: "/awards" },
  { label: "credits", href: "/credits" },
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
