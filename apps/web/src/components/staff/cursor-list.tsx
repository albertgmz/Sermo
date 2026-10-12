// CursorList: a cursor-paginated list for the administration panel. A server component with no
// client state: the cursor lives in the address, so each page of the list is a page of its own
// and "Next" is a link.
//
// Props
//   items       The page's items, as the backend's list read returned them.
//   nextCursor  The read's `nextCursor`, or null on the last page.
//   path        The page's own path (for example "/admin/users").
//   params      The page's current URL parameters, as `searchParams` resolved. They are carried
//               on the paging links, with the cursor replaced.
//   render      (item) => row content. The list wraps each result in a list item.
//   itemKey     (item) => a key for the item (its id).
//   head        Optional column heads, shown above the rows (hide them below `md` when the rows
//               stack as cards).
//   filters     Optional filter bar: a GET form (see `LogTable` for one), shown above the list.
//   empty       Optional { title, description } for the empty state.
//   more        true labels the link "Load more" instead of "Next". The link still opens the next
//               page of the list.
//   cursorParam Name of the cursor parameter. Default: "cursor"; give another when two lists
//               share a page.
//   label       Accessible name of the list. Optional.
//
// `listHref` builds the address of a page of a list; the filter forms use it to reset the cursor.

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ListParams = Record<string, string | string[] | undefined>;

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

export async function CursorList<T>({
  items,
  nextCursor,
  path,
  params,
  render,
  itemKey,
  head,
  filters,
  empty,
  more = false,
  cursorParam = "cursor",
  label,
  className,
}: {
  items: readonly T[];
  nextCursor: string | null;
  path: string;
  params: ListParams;
  render: (item: T) => React.ReactNode;
  itemKey: (item: T) => string | number;
  head?: React.ReactNode;
  filters?: React.ReactNode;
  empty?: { title: React.ReactNode; description?: React.ReactNode };
  more?: boolean;
  cursorParam?: string;
  label?: string;
  className?: string;
}) {
  const t = await getTranslations("admin.cursorList");
  const cursor = cursorFrom(params, cursorParam);
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <section
      className={cn("overflow-hidden rounded-lg border bg-card", className)}
    >
      {filters && <div className="border-b p-4">{filters}</div>}
      {head}
      {items.length > 0 ? (
        <ul aria-label={label} className="divide-y">
          {items.map((item) => (
            <li key={itemKey(item)}>{render(item)}</li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title={empty?.title ?? t("emptyTitle")}
          description={empty?.description ?? t("emptyDescription")}
        />
      )}
      {(cursor || nextCursor) && (
        <nav
          aria-label={t("nav")}
          className="flex flex-wrap gap-2 border-t p-4"
        >
          {cursor && (
            <Link href={listHref(path, params, cursorParam)} className={link}>
              {t("first")}
            </Link>
          )}
          {nextCursor && (
            <Link
              href={listHref(path, params, cursorParam, nextCursor)}
              rel="next"
              className={link}
            >
              {more ? t("loadMore") : t("next")}
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
