import { iconComponent } from "@/components/icons/icon-set";
import {
  type NavItem,
  toNavItems as toPlainNavItems,
} from "@/components/layout/nav";
import type { NavigationEntry } from "@/lib/sermo/navigation";

// `toNavItems` for server code that hands the items to client components: each item carries the
// icon the entry chose, already drawn, so no client bundle holds the icon set (the set is about
// 50 KB). A key the set does not know leaves `iconNode` empty.
function drawn(item: NavItem): NavItem {
  const Icon = iconComponent(item.icon);
  return {
    ...item,
    iconNode: Icon ? <Icon aria-hidden="true" /> : null,
    children: item.children.map(drawn),
  };
}

export function toNavItems(
  entries: NavigationEntry[],
  profileHref: string | null = null,
): NavItem[] {
  return toPlainNavItems(entries, profileHref).map(drawn);
}
