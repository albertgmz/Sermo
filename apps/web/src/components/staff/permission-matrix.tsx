"use client";

// PermissionMatrix: the permissions of one target (a group, a member, or either on one forum) as
// a form body: one row per permission, grouped by category, each with the states the engine
// supports. Render it inside `FormRows` (with `ConfirmPassword`) and read the submitted form with
// `matrixChanges` from ./permission-entries, which returns only the entries that changed. Each
// row carries a hidden field with the value it showed (`was:<id>`): "changed" means different
// from that, not from what the backend holds when the form is posted.
//
// Props
//   permissions  The permissions to show, in display order (see `MatrixPermission`). Built on the
//                server from `permissions.definitions`; pass only the ones the target can hold
//                (for a forum, the ones of node scope).
//   entries      The target's entries now, by permission id, from `permissions.list`; a permission
//                with no entry is "not set" and takes what the engine inherits.
//   allowNo      Whether "No" is offered for a yes/no permission: only on a forum, where it clears
//                an inherited allow for this group alone. Default false.
//
// MatrixPermission
//   id, type, scope  As in the definition.
//   title            The words to show for it; help is the longer line under its id, if any.
//   category         The definition's category (rows are grouped by it, in order of first
//                    appearance); categoryTitle is the heading to show.
//   unit             For an integer: "bytes", "minutes" or "count"; null otherwise.
//   initial          Optional: the default the permission started with for this group, as text.
//
// The rows sit in two tabs, "General permissions" (every category but moderation) and
// "Moderation"; a tab with no rows is left out, and with one tab left there is no tab list. Every
// row of both tabs stays in the form: a hidden tab's controls are submitted as they are. Each tab
// and each category has bulk buttons (allow all, never for all, clear all) that set its yes/no
// rows only, never an integer one ("No" stays a per-row choice). A bar that stays under the
// panel's header holds the tabs and says how many rows changed; a changed row is marked with what
// it showed before.
//
// A filter box above the rows hides the rows whose title or id does not contain what is typed;
// hidden rows stay in the form and are submitted as they are. Bulk buttons set the hidden rows of
// their tab or category too, and say so while the filter is on.

import { Ban, Check, Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  type BulkMode,
  bulkSet,
  type Cell,
  changedIds,
  initialCells,
  matrixTabs,
} from "./matrix-state";
import {
  cellText,
  type MatrixValue,
  modeField,
  numberField,
  wasField,
} from "./permission-entries";
import { selectClass } from "./rows";

export type MatrixPermission = {
  id: string;
  type: "flag" | "integer";
  scope: "global" | "node";
  title: string;
  help?: string;
  category: string;
  categoryTitle: string;
  unit: "bytes" | "minutes" | "count" | null;
  initial?: string | null;
};

type Change = (cell: Cell) => void;

function IntegerControl({
  permission,
  cell,
  onChange,
}: {
  permission: MatrixPermission;
  cell: Cell;
  onChange: Change;
}) {
  const t = useTranslations("adminGroups.matrix");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        name={modeField(permission.id)}
        value={cell.mode}
        onChange={(event) => onChange({ ...cell, mode: event.target.value })}
        aria-label={permission.title}
        className={cn(selectClass, "w-auto min-w-36 flex-1")}
      >
        <option value="">{t("notSet")}</option>
        <option value="value">{t("limit")}</option>
        <option value="unlimited">{t("unlimited")}</option>
      </select>
      {cell.mode === "value" && (
        <>
          <Input
            name={numberField(permission.id)}
            type="number"
            inputMode="numeric"
            min={0}
            value={cell.amount}
            onChange={(event) =>
              onChange({ ...cell, amount: event.target.value })
            }
            aria-label={t("amount", { title: permission.title })}
            className="w-28 flex-none"
          />
          {permission.unit && (
            <span className="text-xs text-muted-foreground">
              {t(`units.${permission.unit}`)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function FlagControl({
  permission,
  cell,
  allowNo,
  onChange,
}: {
  permission: MatrixPermission;
  cell: Cell;
  allowNo: boolean;
  onChange: Change;
}) {
  const t = useTranslations("adminGroups.matrix");
  return (
    <select
      name={modeField(permission.id)}
      value={cell.mode}
      onChange={(event) => onChange({ ...cell, mode: event.target.value })}
      aria-label={permission.title}
      className={selectClass}
    >
      <option value="">{t("notSet")}</option>
      <option value="allow">{t("allow")}</option>
      {allowNo && <option value="no">{t("no")}</option>}
      <option value="never">{t("never")}</option>
    </select>
  );
}

const BULK: {
  mode: BulkMode;
  key: "allowAll" | "neverAll" | "clearAll";
  short: "allowShort" | "neverShort" | "clearShort";
}[] = [
  { mode: "allow", key: "allowAll", short: "allowShort" },
  { mode: "never", key: "neverAll", short: "neverShort" },
  { mode: "", key: "clearAll", short: "clearShort" },
];
const BULK_ICONS = { allow: Check, never: Ban, "": Eraser };

// The three bulk buttons of a tab or a category (`scope` names it). `compact` (a category's)
// shows a one-word label on a phone, so the three fit beside each other.
function BulkButtons({
  scope,
  compact = false,
  onPick,
}: {
  scope: string;
  compact?: boolean;
  onPick: (mode: BulkMode) => void;
}) {
  const t = useTranslations("adminGroups.matrix");
  return (
    <fieldset
      aria-label={t("bulkLabel", { scope })}
      className="flex min-w-0 flex-wrap gap-1"
    >
      {BULK.map(({ mode, key, short }) => {
        const Icon = BULK_ICONS[mode];
        return (
          <Button
            key={key}
            type="button"
            variant={compact ? "ghost" : "outline"}
            size="sm"
            onClick={() => onPick(mode)}
            className="h-10 min-w-10 md:h-8 md:min-w-8"
          >
            <Icon aria-hidden="true" />
            {compact ? (
              <>
                <span className="sm:hidden">{t(short)}</span>
                <span className="hidden sm:inline">{t(key)}</span>
              </>
            ) : (
              t(key)
            )}
          </Button>
        );
      })}
    </fieldset>
  );
}

// What a row showed before it was changed, in the words of its controls.
function shownText(
  t: ReturnType<typeof useTranslations<"adminGroups.matrix">>,
  value: MatrixValue | undefined,
) {
  if (value === undefined) return t("notSet");
  if (value === "allow" || value === "no" || value === "never") return t(value);
  return value === -1 ? t("unlimited") : String(value);
}

export function PermissionMatrix({
  permissions,
  entries,
  allowNo = false,
}: {
  permissions: readonly MatrixPermission[];
  entries: Readonly<Record<string, MatrixValue>>;
  allowNo?: boolean;
}) {
  const t = useTranslations("adminGroups.matrix");
  const [filter, setFilter] = useState("");
  const [cells, setCells] = useState(() => initialCells(permissions, entries));
  const root = useRef<HTMLDivElement>(null);
  const needle = filter.trim().toLowerCase();
  const shows = (permission: MatrixPermission) =>
    needle === "" ||
    permission.title.toLowerCase().includes(needle) ||
    permission.id.toLowerCase().includes(needle);
  const shown = permissions.filter(shows).length;
  const changed = new Set(changedIds(permissions, cells, entries, allowNo));
  const tabs = matrixTabs(permissions);
  const setCell = (id: string) => (cell: Cell) =>
    setCells((current) => ({ ...current, [id]: cell }));
  const bulk =
    (rows: readonly MatrixPermission[]) =>
    (mode: BulkMode): void =>
      setCells((current) => bulkSet(current, rows, mode));

  const panel = ({ tab, rows, categories }: (typeof tabs)[number]) => {
    // A filter that finds nothing here but something on the other tab says where.
    const elsewhere = tabs.find(
      (other) => other.tab !== tab && other.rows.some(shows),
    );
    return (
      <>
        {rows.some((entry) => entry.type === "flag") && (
          <div className="space-y-2 border-b p-4">
            <BulkButtons scope={t(`tabs.${tab}`)} onPick={bulk(rows)} />
            <p className="text-xs text-pretty text-muted-foreground">
              {t(needle === "" ? "bulkHelp" : "bulkHelpFiltered")}
            </p>
          </div>
        )}
        {!rows.some(shows) && (
          <p className="p-4 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {elsewhere
              ? t("noMatchElsewhere", {
                  query: filter.trim(),
                  tab: t(`tabs.${elsewhere.tab}`),
                  count: elsewhere.rows.filter(shows).length,
                })
              : t("noMatch", { query: filter.trim() })}
          </p>
        )}
        {categories.map(({ category, rows: group }) => {
          return (
            <section
              key={category}
              hidden={!group.some(shows)}
              aria-labelledby={`matrix-${category}`}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b bg-muted/40 px-4 py-1">
                <h3
                  id={`matrix-${category}`}
                  className="me-auto py-2 text-xs font-semibold tracking-wide uppercase"
                >
                  {group[0].categoryTitle}
                </h3>
                {group.some((entry) => entry.type === "flag") && (
                  <BulkButtons
                    scope={group[0].categoryTitle}
                    compact
                    onPick={bulk(group)}
                  />
                )}
              </div>
              <ul className="divide-y">
                {group.map((permission) => (
                  <PermissionRow
                    key={permission.id}
                    permission={permission}
                    entry={entries[permission.id]}
                    cell={cells[permission.id]}
                    changed={changed.has(permission.id)}
                    hidden={!shows(permission)}
                    allowNo={allowNo}
                    onChange={setCell(permission.id)}
                    was={shownText(t, entries[permission.id])}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </>
    );
  };

  return (
    <div ref={root} className="scroll-mt-14">
      <div className="space-y-2 border-b p-4">
        <label htmlFor="matrix-filter" className="text-sm font-medium">
          {t("filter")}
        </label>
        <Input
          id="matrix-filter"
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          // Enter in the filter must not save the form.
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          autoComplete="off"
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {t("shown", { shown, total: permissions.length })}
        </p>
        <p className="text-xs text-pretty text-muted-foreground">
          {t(allowNo ? "legendNode" : "legend")}
        </p>
      </div>
      <Tabs
        defaultValue={tabs[0]?.tab}
        // Switching tabs from the bar while it is stuck shows the new tab from its top.
        onValueChange={() => {
          const box = root.current;
          if (box && box.getBoundingClientRect().top < 0) {
            box.scrollIntoView({ block: "start" });
          }
        }}
        className="gap-0"
      >
        <div className="sticky top-14 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-card/95 px-4 py-1.5 backdrop-blur-sm">
          {tabs.length > 1 && (
            <TabsList
              variant="line"
              aria-label={t("tabsLabel")}
              className="grid w-full grid-cols-2 gap-1 p-0 group-data-horizontal/tabs:h-11 sm:inline-flex sm:w-fit"
            >
              {tabs.map(({ tab, rows }) => (
                <TabsTrigger key={tab} value={tab} className="px-3">
                  {t(`tabs.${tab}`)}
                  <span className="hidden rounded-sm bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums sm:inline">
                    {rows.filter(shows).length}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          )}
          <p
            aria-live="polite"
            className={cn(
              "ms-auto py-2 text-xs font-medium",
              changed.size > 0 ? "text-primary-ink" : "text-muted-foreground",
            )}
          >
            {t("changedCount", { count: changed.size })}
          </p>
        </div>
        {tabs.length > 1
          ? tabs.map((entry) => (
              <TabsContent
                key={entry.tab}
                value={entry.tab}
                // Kept in the form while hidden: every row is submitted.
                keepMounted
                className="focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                {panel(entry)}
              </TabsContent>
            ))
          : tabs.map((entry) => <div key={entry.tab}>{panel(entry)}</div>)}
      </Tabs>
    </div>
  );
}

function PermissionRow({
  permission,
  entry,
  cell,
  changed,
  hidden,
  allowNo,
  onChange,
  was,
}: {
  permission: MatrixPermission;
  entry: MatrixValue | undefined;
  cell: Cell;
  changed: boolean;
  hidden: boolean;
  allowNo: boolean;
  onChange: Change;
  was: string;
}) {
  const t = useTranslations("adminGroups.matrix");
  return (
    <li
      hidden={hidden}
      data-changed={changed ? "" : undefined}
      className={cn(
        "grid gap-2 border-l-2 p-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center",
        entry === undefined ? "border-l-transparent" : "border-l-primary",
        changed && "bg-muted/50",
      )}
    >
      <div className="min-w-0">
        <input
          type="hidden"
          name={wasField(permission.id)}
          value={cellText(entry)}
        />
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="[overflow-wrap:anywhere]">{permission.title}</span>
          {entry !== undefined && (
            <span className="rounded-sm border border-primary/40 px-1.5 text-xs font-normal text-primary-ink">
              {t("setHere")}
            </span>
          )}
          {changed && (
            <span className="rounded-sm bg-primary/15 px-1.5 text-xs font-normal text-primary-ink">
              {t("changed", { was })}
            </span>
          )}
        </p>
        <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {permission.id}
          {permission.scope === "node" && ` · ${t("forumScope")}`}
        </p>
        {permission.help && (
          <p className="text-xs text-pretty text-muted-foreground">
            {permission.help}
          </p>
        )}
        {permission.initial && (
          <p className="text-xs text-muted-foreground">
            {t("initial", { value: permission.initial })}
          </p>
        )}
      </div>
      {permission.type === "integer" ? (
        <IntegerControl
          permission={permission}
          cell={cell}
          onChange={onChange}
        />
      ) : (
        <FlagControl
          permission={permission}
          cell={cell}
          allowNo={allowNo}
          onChange={onChange}
        />
      )}
    </li>
  );
}
