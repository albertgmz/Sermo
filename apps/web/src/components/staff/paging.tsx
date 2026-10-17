// Paging by cursor, for the lists the backend pages: the cursor lives in the address, so each page
// of a list is a page of its own and "Next" is a link. Server-safe, and usable in a client
// component.
//
// Paging (what `PagingLinks` and `ItemList`'s `paging` take)
//   path         The page's own path (for example "/admin/users").
//   params       The page's current URL parameters, as `searchParams` resolved. They are carried
//                on the paging links, with the cursor replaced and a save's `notice` dropped (it
//                belongs to the page it was shown on).
//   nextCursor   The read's `nextCursor`, or null on the last page.
//   cursorParam  Name of the cursor parameter. Default: "cursor"; give another when two lists
//                share a page.
//
// PagingLinks: "Back to the first page" (past the first page) and "Next" (or "Load more" with
// `more`); nothing on a list of one page.
//
// `listHref` builds the address of a page of a list; the filter forms use it to reset the cursor.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ListParams = Record<string, string | string[] | undefined>;

export type Paging = {
  path: string;
  params: ListParams;
  nextCursor: string | null;
  cursorParam?: string;
};

// The address of a page of a list: the path and the current parameters, with the cursor set (or
// dropped for the first page).
export function listHref(
  path: string,
  params: ListParams,
  cursorParam: string,
  cursor?: string,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === cursorParam || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      query.append(key, item);
    }
  }
  if (cursor) query.set(cursorParam, cursor);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

// The cursor in the address, if there is one.
export function cursorFrom(params: ListParams, cursorParam = "cursor") {
  const value = params[cursorParam];
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

// Whether the list has a page before or after this one.
export function hasPages({
  params,
  nextCursor,
  cursorParam = "cursor",
}: Paging) {
  return Boolean(cursorFrom(params, cursorParam) || nextCursor);
}

export function PagingLinks({
  path,
  params,
  nextCursor,
  cursorParam = "cursor",
  more = false,
  className,
}: Paging & { more?: boolean; className?: string }) {
  const t = useTranslations("admin.cursorList");
  const cursor = cursorFrom(params, cursorParam);
  if (!cursor && !nextCursor) return null;
  const { notice: _notice, ...kept } = params;
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <nav
      aria-label={t("nav")}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {cursor && (
        <Link href={listHref(path, kept, cursorParam)} className={link}>
          {t("first")}
        </Link>
      )}
      {nextCursor && (
        <Link
          href={listHref(path, kept, cursorParam, nextCursor)}
          rel="next"
          className={link}
        >
          {more ? t("loadMore") : t("next")}
        </Link>
      )}
    </nav>
  );
}
