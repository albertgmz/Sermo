"use server";

import { getTranslations } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { getViewer } from "@/lib/sermo/session";
import { getDefinitions } from "./admin/permissions/data";
import { buildSearchIndex } from "./search-index";
import type { SearchEntry } from "./search-match";

// The panel search's index, asked for once when the search box opens. The language is the page's
// (an action has no route to take it from); what the viewer may open is decided here, from their
// own `auth.me`, as the navigation decides it.
export async function readStaffSearch(locale: string): Promise<SearchEntry[]> {
  const [viewer, t] = await Promise.all([
    getViewer(),
    getTranslations({ locale: isLocale(locale) ? locale : DEFAULT_LOCALE }),
  ]);
  return buildSearchIndex({
    viewer,
    t: (key) => t(key as never),
    definitions: getDefinitions,
  });
}
