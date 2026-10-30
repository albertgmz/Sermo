import { getLocale, getNow, getTranslations } from "next-intl/server";
import { formatPast } from "@/lib/format";

/**
 * The text of `RelativeTime` for a place that takes a string only: a parameter of a message that
 * other messages share, or an `aria-label`. Anywhere else use `RelativeTime`, which also gives the
 * tooltip and updates itself. Call this after the page has read its request-time data.
 */
export async function getPastText(): Promise<(date: string) => string> {
  const [locale, now, t] = await Promise.all([
    getLocale(),
    getNow(),
    getTranslations("forum.relativeTime"),
  ]);
  const justNow = t("justNow");
  return (date) => formatPast(date, now, locale, justNow);
}
