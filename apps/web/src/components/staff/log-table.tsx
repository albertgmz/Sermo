// LogTable: a filterable log for the administration panel. A server component: the filters are a
// GET form, so the address holds every choice, and the rows page through `CursorList`. Each row
// shows time, actor, action and target, and the details expand in place. From `md` up the rows
// are columns under a head; below, each row is a stacked card, so nothing scrolls sideways.
//
// Props
//   entries     The rows (see `LogEntry`), already mapped from the backend's list read.
//   nextCursor  The read's `nextCursor`, or null.
//   path        The page's own path.
//   params      The page's current URL parameters (`searchParams` resolved): they prefill the
//               filters and are carried on the paging links.
//   filters     Which filters to show. Only what is passed is rendered: `search` (free text, with
//               an optional `hint` line under it),
//               `selects` (one select each), `dates` (a from / to range, as date fields), `carry`
//               (parameters of the page that are chosen elsewhere, kept through Apply as hidden
//               fields). Pass only the filters the backend read supports. Omit it for a log
//               without filters.
//   empty       Optional { title, description } for the empty state.
//   label       Accessible name of the log.
//
// LogEntry
//   id        A stable key.
//   at        ISO timestamp.
//   actor     What to show for who did it (a `UserLink`, a name); null shows "System".
//   action    What was done (text or a node).
//   actionId  The backend's action id, when `action` is that id: shown as its label from the
//             messages, with the id under it, or as the id alone when there is no label.
//   target    What it was done to (text or a link).
//   details   Optional { key: value } record, shown in an expandable block. A value that is not a
//             string, number or boolean is shown as JSON.
//   reason    Optional text, shown with the details.

import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { actionLabel } from "./action-label";
import { CursorList, type ListParams } from "./cursor-list";
import { selectClass } from "./rows";

export type LogEntry = {
  id: string | number;
  at: string;
  actor: React.ReactNode | null;
  action: React.ReactNode;
  actionId?: string;
  target: React.ReactNode;
  details?: Record<string, unknown> | null;
  reason?: string;
};

export type LogFilters = {
  search?: { name: string; label: string; hint?: string };
  selects?: {
    name: string;
    label: string;
    options: { value: string; label: string }[];
  }[];
  dates?: { from: string; to: string };
  carry?: Record<string, string>;
};

const COLUMNS = "md:grid-cols-[10rem_11rem_10rem_minmax(0,1fr)]";

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";

async function FilterForm({
  path,
  params,
  filters,
}: {
  path: string;
  params: ListParams;
  filters: LogFilters;
}) {
  const t = await getTranslations("admin.logTable");
  const { search, selects = [], dates, carry = {} } = filters;
  const field = "grid min-w-0 gap-1.5 text-xs font-medium";
  return (
    <form method="get" action={path} aria-label={t("filters")}>
      {Object.entries(carry).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {search && (
          <label htmlFor={`filter-${search.name}`} className={field}>
            {search.label}
            <Input
              id={`filter-${search.name}`}
              type="search"
              name={search.name}
              defaultValue={first(params[search.name])}
              aria-describedby={
                search.hint ? `filter-${search.name}-hint` : undefined
              }
            />
            {search.hint && (
              <span
                id={`filter-${search.name}-hint`}
                className="font-normal text-muted-foreground"
              >
                {search.hint}
              </span>
            )}
          </label>
        )}
        {selects.map((select) => (
          <label key={select.name} className={field}>
            {select.label}
            <select
              name={select.name}
              defaultValue={first(params[select.name])}
              className={selectClass}
            >
              <option value="">{t("all")}</option>
              {select.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ))}
        {dates && (
          <>
            <label htmlFor={`filter-${dates.from}`} className={field}>
              {t("from")}
              <Input
                id={`filter-${dates.from}`}
                type="date"
                name={dates.from}
                defaultValue={first(params[dates.from])}
              />
            </label>
            <label htmlFor={`filter-${dates.to}`} className={field}>
              {t("to")}
              <Input
                id={`filter-${dates.to}`}
                type="date"
                name={dates.to}
                defaultValue={first(params[dates.to])}
              />
            </label>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" className="min-h-10 px-4">
          {t("apply")}
        </Button>
        <Link
          href={path}
          className="inline-flex min-h-10 items-center px-2 text-sm text-primary underline-offset-4 hover:underline"
        >
          {t("reset")}
        </Link>
      </div>
    </form>
  );
}

function detailText(value: unknown) {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? String(value)
    : JSON.stringify(value);
}

async function Row({ entry }: { entry: LogEntry }) {
  const [t, names, format] = await Promise.all([
    getTranslations("admin.logTable"),
    getTranslations("admin.logTable.actions"),
    getFormatter(),
  ]);
  const when = new Date(entry.at);
  const details = Object.entries(entry.details ?? {});
  const named = entry.actionId ? actionLabel(names, entry.actionId) : null;
  const expandable = details.length > 0 || Boolean(entry.reason);
  return (
    <div className={`grid gap-x-4 gap-y-1 p-4 md:items-start ${COLUMNS}`}>
      <time
        dateTime={entry.at}
        className="text-xs text-muted-foreground md:pt-0.5"
      >
        {format.dateTime(when, { dateStyle: "medium", timeStyle: "short" })}
      </time>
      <div className="min-w-0 text-sm [overflow-wrap:anywhere]">
        {entry.actor ?? (
          <span className="text-muted-foreground">{t("system")}</span>
        )}
      </div>
      <div className="min-w-0 text-sm font-medium [overflow-wrap:anywhere]">
        {named ? (
          <>
            {named}
            <span className="block text-xs font-normal text-muted-foreground">
              {entry.actionId}
            </span>
          </>
        ) : (
          entry.action
        )}
      </div>
      <div className="min-w-0 space-y-1 text-sm [overflow-wrap:anywhere]">
        <div>{entry.target}</div>
        {expandable && (
          <details className="group">
            <summary className="inline-flex min-h-10 cursor-pointer items-center text-xs text-primary underline-offset-4 hover:underline">
              {t("showDetails")}
            </summary>
            <div className="space-y-2 rounded-md border bg-background p-3 text-xs">
              {entry.reason && <p>{entry.reason}</p>}
              {details.length > 0 && (
                <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[max-content_minmax(0,1fr)]">
                  {details.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="min-w-0 font-mono">{detailText(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export async function LogTable({
  entries,
  nextCursor,
  path,
  params,
  filters,
  empty,
  label,
}: {
  entries: readonly LogEntry[];
  nextCursor: string | null;
  path: string;
  params: ListParams;
  filters?: LogFilters;
  empty?: { title: React.ReactNode; description?: React.ReactNode };
  label?: string;
}) {
  const t = await getTranslations("admin.logTable");
  return (
    <CursorList
      items={entries}
      nextCursor={nextCursor}
      path={path}
      params={params}
      itemKey={(entry) => entry.id}
      render={(entry) => <Row entry={entry} />}
      label={label ?? t("table")}
      empty={
        empty ?? { title: t("emptyTitle"), description: t("emptyDescription") }
      }
      filters={
        filters && <FilterForm path={path} params={params} filters={filters} />
      }
      head={
        <div
          className={`hidden gap-x-4 border-b px-4 py-2 text-xs font-semibold text-muted-foreground md:grid ${COLUMNS}`}
        >
          <span>{t("time")}</span>
          <span>{t("actor")}</span>
          <span>{t("action")}</span>
          <span>{t("target")}</span>
        </div>
      }
    />
  );
}
