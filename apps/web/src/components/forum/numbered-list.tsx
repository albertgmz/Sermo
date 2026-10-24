import type { ReactNode } from "react";
import { PageNav } from "@/components/forum/page-nav";
import type { PageParams } from "@/components/forum/page-window";
import type { ListRow } from "@/lib/list-pages";
import { cn } from "@/lib/utils";

// NumberedList: one page of a list drawn on the server, between two numbered pagers (`PageNav`) as
// XenForo draws a forum's threads: the one above shows from a wide screen up, the one below
// always; neither shows for a list of one page. Put it inside a `PageSwitch` to turn its pages in
// place.
//
// Props
//   page     The page shown.
//   pages    How many pages the list has.
//   path     The list's address without its query.
//   params   The list's other parameters, kept on every page's address.
//   rows     The rows of the page, each drawn as one item.
//   header   A heading line for the box (a `SectionHeader`); the box then holds the heading and
//            the rows, and `className` is the box's.
//   className  The box around the rows (its border and background; the space above the whole
//              belongs to whatever holds it).

export function NumberedList({
  page,
  pages,
  path,
  params,
  rows,
  header,
  className,
}: {
  page: number;
  pages: number;
  path: string;
  params?: PageParams;
  rows: ListRow[];
  header?: ReactNode;
  className?: string;
}) {
  const pager = (where: string) => (
    <PageNav
      page={page}
      pages={pages}
      path={path}
      params={params}
      className={where}
    />
  );
  const list = (
    <ul
      className={cn("divide-y divide-border", header ? undefined : className)}
    >
      {rows.map((row) => (
        <li key={row.key}>{row.node}</li>
      ))}
    </ul>
  );
  return (
    <>
      {pager("mb-3 max-sm:hidden")}
      {header ? (
        <div className={className}>
          {header}
          {list}
        </div>
      ) : (
        list
      )}
      {pager("mt-3")}
    </>
  );
}
