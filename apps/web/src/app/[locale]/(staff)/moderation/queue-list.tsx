import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  cursorFrom,
  type ListParams,
  listHref,
} from "@/components/staff/cursor-list";
import { type Item, ItemList } from "@/components/staff/item-list";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// QueueList: a list of the moderation screens that the backend pages by cursor and filters on its
// side. The filter form (a GET form, so the address holds the choice) sits in a card above the
// rows, which are the panel's `ItemList`; the way on is a pair of links under it. The cursor lives
// in the address, as in `CursorList`.
//
// Props
//   items       The rows, as `ItemList` takes them.
//   nextCursor  The read's `nextCursor`, or null on the last page.
//   path        The page's own path.
//   params      The page's current URL parameters, carried on the paging links.
//   label       The list's accessible name.
//   empty       What shows when the page has no rows.
//   filters     Optional filter form.
export async function QueueList({
  items,
  nextCursor,
  path,
  params,
  label,
  empty,
  filters,
}: {
  items: Item[];
  nextCursor: string | null;
  path: string;
  params: ListParams;
  label: string;
  empty: { title: string; description?: string };
  filters?: React.ReactNode;
}) {
  const t = await getTranslations("admin.cursorList");
  const cursor = cursorFrom(params);
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <div className="space-y-4">
      {filters && (
        <section className="rounded-lg border bg-card p-4">{filters}</section>
      )}
      <ItemList label={label} items={items} empty={empty} />
      {(cursor || nextCursor) && (
        <nav aria-label={t("nav")} className="flex flex-wrap gap-2">
          {cursor && (
            <Link href={listHref(path, params, "cursor")} className={link}>
              {t("first")}
            </Link>
          )}
          {nextCursor && (
            <Link
              href={listHref(path, params, "cursor", nextCursor)}
              rel="next"
              className={link}
            >
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
