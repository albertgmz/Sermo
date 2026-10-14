import {
  Bell,
  Crown,
  House,
  Inbox,
  Link as LinkIcon,
  LogIn,
  type LucideIcon,
  MessagesSquare,
  Settings,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import type { NavigationEntry, NavigationLink } from "@/lib/sermo/navigation";

// The entries, their order and their titles are data. What stays here is how a built-in entry is
// drawn, keyed by its stable `builtin` key.

export type NavItem = {
  id: number;
  title: string;
  href: string | null;
  external: boolean;
  builtin: string | null;
  icon: string | null;
  iconPosition: "before" | "after";
  // The chosen icon, drawn on the server (`toNavItems` of `nav-server.tsx`): this file is
  // imported by client components and must not pull in the icon set.
  iconNode: ReactNode;
  match: string[];
  children: NavItem[];
};

export type LinkItem = NavItem & { href: string };

const ICONS: Record<string, LucideIcon> = {
  "mobile.home": House,
  "mobile.forums": MessagesSquare,
  "mobile.messages": Inbox,
  "mobile.alerts": Bell,
  "mobile.profile": UserRound,
  "mobile.login": LogIn,
  "account.profile": UserRound,
  "account.settings": Settings,
  "account.upgrade": Crown,
};

// Paths that also mark an entry as current.
const MATCH: Record<string, string[]> = {
  "header.forums": ["/threads"],
  "mobile.forums": ["/threads"],
  "mobile.profile": ["/account"],
};

// These lead to the signed-in member's own profile whatever target is stored.
const OWN_PROFILE = new Set(["mobile.profile", "account.profile"]);
const MOBILE_LIMIT = 5;

export function iconFor(builtin: string | null): LucideIcon {
  return (builtin && ICONS[builtin]) || LinkIcon;
}

export function isExternal(target: string) {
  return /^https?:\/\//i.test(target);
}

function item(
  entry: NavigationLink,
  profileHref: string | null,
  children: NavItem[],
): NavItem {
  const own = !!entry.builtin && OWN_PROFILE.has(entry.builtin) && profileHref;
  const href = own ? profileHref : entry.target;
  return {
    id: entry.id,
    title: entry.title,
    href,
    external: !!href && isExternal(href),
    builtin: entry.builtin,
    icon: entry.icon,
    iconPosition: entry.iconPosition,
    iconNode: null,
    match: (entry.builtin && MATCH[entry.builtin]) || [],
    children,
  };
}

export function toNavItems(
  entries: NavigationEntry[],
  profileHref: string | null = null,
): NavItem[] {
  return entries.map((entry) =>
    item(
      entry,
      profileHref,
      entry.children.map((child) => item(child, profileHref, [])),
    ),
  );
}

export function hasHref(entry: NavItem): entry is LinkItem {
  return entry.href !== null;
}

// The bar at the bottom of a phone has room for about five entries and no labels for headings.
export function mobileItems(entries: NavItem[]): LinkItem[] {
  return entries
    .filter(hasHref)
    .slice(0, MOBILE_LIMIT)
    .map((entry) => ({ ...entry, children: [] }));
}

// The account menu is a flat list: a heading gives way to its children.
export function accountItems(entries: NavItem[]): LinkItem[] {
  return entries.flatMap((entry) =>
    hasHref(entry) ? [entry] : entry.children.filter(hasHref),
  );
}

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

// An external link is never current.
export function isCurrent(pathname: string, entry: NavItem) {
  if (!entry.href || entry.external) return false;
  return isActivePath(pathname, entry.href.split(/[?#]/)[0], entry.match);
}

export function linkProps(entry: LinkItem) {
  return entry.external
    ? { href: entry.href, target: "_blank", rel: "noopener noreferrer" }
    : { href: entry.href };
}
