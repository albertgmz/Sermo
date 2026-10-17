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

// PagedItems: a list of the panel's rows (`ItemList`) for a read that pages by cursor, as the
// members, the bans, the warnings and the like do. The cursor lives in the address, so "Next" is
// a link that keeps the other parameters (`CursorList` does the same for its table rows).
//
// Props
//   items, label, heading, description, empty  Those of `ItemList`.
//   nextCursor   The read's `nextCursor`, or null on the last page.
//   path         The page's own path.
//   params       The page's URL parameters, carried on the paging links.
//   cursorParam  Name of the cursor parameter. Default: "cursor"; give another when two lists
//                share a page.
//   filters      Optional filter form (a GET form), in a card above the rows.
export async function PagedItems({
  items,
  nextCursor,
  path,
  params,
  cursorParam = "cursor",
  label,
  heading,
  description,
  empty,
  filters,
}: {
  items: Item[];
  nextCursor: string | null;
  path: string;
  params: ListParams;
  cursorParam?: string;
  label: string;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  empty: { title: string; description?: string };
  filters?: React.ReactNode;
}) {
  const t = await getTranslations("admin.cursorList");
  const cursor = cursorFrom(params, cursorParam);
  const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");
  return (
    <div className="space-y-4">
      {filters && (
        <div className="rounded-lg border bg-card p-4">{filters}</div>
      )}
      <ItemList
        label={label}
        heading={heading}
        description={description}
        items={items}
        empty={empty}
      />
      {(cursor || nextCursor) && (
        <nav aria-label={t("nav")} className="flex flex-wrap gap-2">
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
              {t("next")}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
