import "server-only";

import { navigationGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import { messages } from "@/i18n/messages";
import { call } from "./client";
import { SermoError } from "./errors";

export type NavigationLink = {
  id: number;
  title: string;
  target: string | null;
  builtin: string | null;
  icon: string | null;
  iconPosition: "before" | "after";
};
export type NavigationEntry = NavigationLink & { children: NavigationLink[] };
export type Navigation = {
  header: NavigationEntry[];
  mobile: NavigationEntry[];
  account: NavigationEntry[];
  footer: NavigationEntry[];
};

// The entries the install ships with are stored with their English titles. One that still has its
// seeded title is drawn with the message of the same entry in the visitor's language; one that was
// renamed keeps the name it was given. `footer.legal.notice` is the message `footerLegalNotice`.
const SEEDED = messages.layout.navigation as Record<string, string>;

const messageKey = (builtin: string) =>
  builtin
    .split(".")
    .map((part, index) =>
      index === 0 ? part : part[0]?.toUpperCase() + part.slice(1),
    )
    .join("");

type Say = (key: string) => string;

function titled<T extends NavigationLink>(link: T, say: Say): T {
  const key = link.builtin ? messageKey(link.builtin) : null;
  if (!key || SEEDED[key] !== link.title) return link;
  return { ...link, title: say(key) };
}

function translated(navigation: Navigation, say: Say): Navigation {
  const entries = (list: NavigationEntry[]) =>
    list.map((entry) => ({
      ...titled(entry, say),
      children: entry.children.map((child) => titled(child, say)),
    }));
  return {
    header: entries(navigation.header),
    mobile: entries(navigation.mobile),
    account: entries(navigation.account),
    footer: entries(navigation.footer),
  };
}

const EMPTY: Navigation = { header: [], mobile: [], account: [], footer: [] };

// What the current visitor may see, so it is asked with their cookies once per request. A backend
// that cannot be reached leaves the lists empty and the page still renders. Anything that is not
// an API error (the signal that this read needs the request) is passed on.
export const getNavigation = cache(async (): Promise<Navigation> => {
  try {
    const navigation = await call(navigationGet, {});
    const t = await getTranslations("layout.navigation");
    return translated(navigation, (key) => t(key as never));
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The navigation could not be read from the API", error);
    return EMPTY;
  }
});
