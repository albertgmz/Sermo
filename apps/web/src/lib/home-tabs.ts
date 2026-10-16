import { HOME_TABS } from "@sermo/core/contracts";

// The tabs of the home page, in the fixed order they are pinned: the backend's own list.
export { HOME_TABS };

export type HomeTab = (typeof HOME_TABS)[number];

// How many tabs the bar shows; the rest are in the "More" menu.
export const PINNED_TABS = 3;

// A tab named in the address, or null when it names none that exists.
export function tabParam(value: unknown): HomeTab | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return HOME_TABS.find((tab) => tab === raw) ?? null;
}

// The tab to open: the one the address names, else the default of the visitor (their own choice, or
// the site's). Following needs an account, so a guest gets Latest in its place.
export function openTab({
  named,
  home,
  signedIn,
}: {
  named: HomeTab | null;
  home: HomeTab;
  signedIn: boolean;
}): HomeTab {
  const tab = named ?? home;
  return tab === "following" && !signedIn ? "latest" : tab;
}

// The tabs a visitor has.
export const tabsFor = (signedIn: boolean): HomeTab[] =>
  HOME_TABS.filter((tab) => signedIn || tab !== "following");

// Which tabs the bar shows and which go in "More". The bar holds the default tab and then the
// first ones of the fixed order, up to PINNED_TABS, drawn in the fixed order. The tab that is open
// is always on the bar: when it is not among them it takes the place of the last one that is not
// the default.
export function barOf({
  active,
  fallback,
  signedIn,
}: {
  active: HomeTab;
  fallback: HomeTab;
  signedIn: boolean;
}): { bar: HomeTab[]; more: HomeTab[] } {
  const all = tabsFor(signedIn);
  const home = all.includes(fallback) ? fallback : "latest";
  const chosen = new Set<HomeTab>([home]);
  for (const tab of all) {
    if (chosen.size >= PINNED_TABS) break;
    chosen.add(tab);
  }
  if (!chosen.has(active)) {
    const last = [...all]
      .reverse()
      .find((tab) => chosen.has(tab) && tab !== home);
    if (last) chosen.delete(last);
    chosen.add(active);
  }
  return {
    bar: all.filter((tab) => chosen.has(tab)),
    more: all.filter((tab) => !chosen.has(tab)),
  };
}

// The tabs a phone keeps in "More" while another one is open.
const PHONE_MORE: readonly HomeTab[] = ["media"];

// Which tabs the bar shows on a phone, where the default does not change it: every tab in the fixed
// order but Media, which is in "More" unless it is open.
export function phoneBarOf({
  active,
  signedIn,
}: {
  active: HomeTab;
  signedIn: boolean;
}): { bar: HomeTab[]; more: HomeTab[] } {
  const all = tabsFor(signedIn);
  const more = all.filter((tab) => PHONE_MORE.includes(tab) && tab !== active);
  return { bar: all.filter((tab) => !more.includes(tab)), more };
}

// The address of a tab: always named, because what the bare address opens depends on the visitor.
export function homeHref(tab: HomeTab, cursor?: string) {
  const params = new URLSearchParams({ tab });
  if (cursor) params.set("cursor", cursor);
  return `/?${params.toString()}`;
}
