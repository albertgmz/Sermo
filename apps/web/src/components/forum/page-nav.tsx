import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { threadPageHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import {
  lastPages,
  type PageParams,
  type PagerEntry,
  pageAddress,
  pagerEntries,
} from "@/components/forum/page-window";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// PageNav: the numbered pager of a list, as XenForo's: previous, the first page, the pages around
// the current one, the last page, next; a "…" between them opens "go to page". A server component
// with no script of its own: every page is a plain link and "go to page" a GET form, so it works
// without JavaScript. Inside a `PageSwitch` the same links and form change the page in place.
//
// Props
//   page     The page shown.
//   pages    How many pages the list has (a page past them is shown as the last one).
//   path     The list's address without its query.
//   params   The list's other parameters, kept on every page's address (the page one dropped).
//   param    Name of the page parameter. Default "page".
//   next     The address of the page after the last numbered one, when the list goes on past
//            them (a moderator's view of a thread past its last visible post). Optional.
//   label    Accessible name of the bar. Default "Pages".

const cell =
  "inline-flex h-10 min-w-8 items-center justify-center rounded-md border border-border bg-card px-1 text-sm font-medium tabular-nums text-foreground transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9 sm:min-w-9 sm:px-2";
const current =
  "border-primary bg-primary text-primary-foreground hover:bg-primary";

// Which screens an entry shows on (see `pagerEntries`).
function screens(entry: PagerEntry) {
  if (entry.wide && entry.narrow) return undefined;
  return entry.wide ? "max-sm:hidden" : "sm:hidden";
}

export function PageNav({
  page,
  pages,
  path,
  params = {},
  param = "page",
  next,
  label,
  className,
}: {
  page: number;
  pages: number;
  path: string;
  params?: PageParams;
  param?: string;
  next?: string;
  label?: string;
  className?: string;
}) {
  const t = useTranslations("forum.pageNav");
  const total = Math.max(pages, page);
  if (total <= 1 && !next) return null;
  const href = (target: number) => pageAddress(path, params, target, param);
  const nextHref = page < total ? href(page + 1) : next;
  return (
    <nav
      aria-label={label ?? t("label")}
      className={cn("flex items-center gap-0.5 sm:gap-1", className)}
    >
      {page > 1 && (
        <a
          href={href(page - 1)}
          data-page={page - 1}
          rel="prev"
          className={cn(cell, "gap-0.5 sm:pr-3")}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          <span className="max-sm:sr-only">{t("previous")}</span>
        </a>
      )}
      <ol className="flex items-center gap-0.5 sm:gap-1">
        {pagerEntries(page, total).map((entry) =>
          entry.kind === "page" ? (
            <li key={entry.page} className={screens(entry)}>
              <a
                href={href(entry.page)}
                data-page={entry.page}
                aria-current={entry.page === page ? "page" : undefined}
                className={cn(cell, entry.page === page && current)}
              >
                {entry.page}
              </a>
            </li>
          ) : (
            <li
              key={`skip-${entry.jump}`}
              className={cn("relative", screens(entry))}
            >
              <PageJump
                page={entry.jump}
                total={total}
                path={path}
                params={params}
                param={param}
                // A skip after the current page opens leftwards, so it stays on a phone's screen.
                align={entry.jump > page ? "end" : "start"}
              />
            </li>
          ),
        )}
      </ol>
      {nextHref &&
        (page < total ? (
          <a
            href={nextHref}
            data-page={page + 1}
            rel="next"
            className={cn(cell, "gap-0.5 sm:pl-3")}
          >
            <span className="max-sm:sr-only">{t("next")}</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </a>
        ) : (
          <Link
            href={nextHref}
            rel="next"
            className={cn(cell, "gap-0.5 sm:pl-3")}
          >
            <span className="max-sm:sr-only">{t("next")}</span>
            <ChevronRight aria-hidden="true" className="size-4" />
          </Link>
        ))}
    </nav>
  );
}

// "…": a disclosure that holds the "go to page" form, filled with the page next to the window. The
// browser checks the number (1 to the last page) when no script runs; `PageSwitch` brings one out
// of range to the nearest page instead, as XenForo does.
function PageJump({
  page,
  total,
  path,
  params,
  param,
  align,
}: {
  page: number;
  total: number;
  path: string;
  params: PageParams;
  param: string;
  align: "start" | "end";
}) {
  const t = useTranslations("forum.pageNav");
  const field = useId();
  return (
    <details data-page-jump="" className="group">
      <summary
        title={t("goTo")}
        aria-label={t("goTo")}
        className={cn(
          cell,
          "cursor-pointer list-none group-open:bg-muted [&::-webkit-details-marker]:hidden",
        )}
      >
        …
      </summary>
      <form
        method="get"
        action={path}
        className={cn(
          "absolute top-full z-30 mt-1 w-max rounded-lg border bg-popover p-3 text-popover-foreground shadow-md",
          align === "end" ? "right-0" : "left-0",
        )}
      >
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor={field}
              className="text-xs font-medium text-muted-foreground"
            >
              {t("goTo")}
            </label>
            <Input
              id={field}
              type="number"
              name={param}
              inputMode="numeric"
              min={1}
              max={total}
              required
              defaultValue={page}
              className="w-24"
            />
          </div>
          <button
            type="submit"
            data-page-go={total}
            className={cn(buttonVariants(), "h-10 px-3 md:h-8")}
          >
            {t("go")}
          </button>
        </div>
        {Object.entries(params).flatMap(([key, value]) =>
          key === param || value === undefined
            ? []
            : (Array.isArray(value) ? value : [value]).map((item) => (
                <input
                  key={`${key}=${item}`}
                  type="hidden"
                  name={key}
                  value={item}
                />
              )),
        )}
      </form>
    </details>
  );
}

// The links beside a thread's title in a list to its last pages, as XenForo's: none for a thread
// of one page. The title opens the thread (where a member left off).
export function ThreadPageLinks({
  threadId,
  pages,
  className,
}: {
  threadId: number;
  // How many pages the thread has.
  pages: number;
  className?: string;
}) {
  const t = useTranslations("forum.pageNav");
  const links = lastPages(pages);
  if (links.length === 0) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      {links.map((page) => (
        <Link
          key={page}
          href={threadPageHref(threadId, page)}
          prefetch={false}
          aria-label={t("page", { page })}
          className="relative z-10 inline-flex h-6 min-w-6 items-center justify-center rounded border border-border bg-card px-1 text-[0.6875rem] leading-none font-medium tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {page}
        </Link>
      ))}
    </span>
  );
}
