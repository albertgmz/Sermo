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
// A filter box above the rows hides the rows whose title or id does not contain what is typed;
// hidden rows stay in the form and are submitted as they are.

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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

function IntegerControl({
  permission,
  value,
}: {
  permission: MatrixPermission;
  value: MatrixValue | undefined;
}) {
  const t = useTranslations("adminGroups.matrix");
  const id = useId();
  const [mode, setMode] = useState(
    value === undefined ? "" : value === -1 ? "unlimited" : "value",
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        id={id}
        name={modeField(permission.id)}
        value={mode}
        onChange={(event) => setMode(event.target.value)}
        aria-label={permission.title}
        className={cn(selectClass, "w-auto min-w-36 flex-1")}
      >
        <option value="">{t("notSet")}</option>
        <option value="value">{t("limit")}</option>
        <option value="unlimited">{t("unlimited")}</option>
      </select>
      {mode === "value" && (
        <>
          <Input
            name={numberField(permission.id)}
            type="number"
            inputMode="numeric"
            min={0}
            defaultValue={
              typeof value === "number" && value >= 0 ? value : undefined
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
  value,
  allowNo,
}: {
  permission: MatrixPermission;
  value: MatrixValue | undefined;
  allowNo: boolean;
}) {
  const t = useTranslations("adminGroups.matrix");
  return (
    <select
      name={modeField(permission.id)}
      defaultValue={typeof value === "string" ? value : ""}
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
  const needle = filter.trim().toLowerCase();
  const shows = (permission: MatrixPermission) =>
    needle === "" ||
    permission.title.toLowerCase().includes(needle) ||
    permission.id.toLowerCase().includes(needle);
  const categories = [...new Set(permissions.map((entry) => entry.category))];
  const shown = permissions.filter(shows).length;
  return (
    <div>
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
      {categories.map((category) => {
        const rows = permissions.filter((entry) => entry.category === category);
        return (
          <section
            key={category}
            hidden={!rows.some(shows)}
            aria-labelledby={`matrix-${category}`}
          >
            <h3
              id={`matrix-${category}`}
              className="border-b bg-muted/40 px-4 py-2 text-xs font-semibold tracking-wide uppercase"
            >
              {rows[0].categoryTitle}
            </h3>
            <ul className="divide-y">
              {rows.map((permission) => {
                const value = entries[permission.id];
                return (
                  <li
                    key={permission.id}
                    hidden={!shows(permission)}
                    className={cn(
                      "grid gap-2 border-l-2 p-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-center",
                      value === undefined
                        ? "border-l-transparent"
                        : "border-l-primary",
                    )}
                  >
                    <div className="min-w-0">
                      <input
                        type="hidden"
                        name={wasField(permission.id)}
                        value={cellText(value)}
                      />
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        <span className="[overflow-wrap:anywhere]">
                          {permission.title}
                        </span>
                        {value !== undefined && (
                          <span className="rounded-sm border border-primary/40 px-1.5 text-xs font-normal text-primary">
                            {t("setHere")}
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
                      <IntegerControl permission={permission} value={value} />
                    ) : (
                      <FlagControl
                        permission={permission}
                        value={value}
                        allowNo={allowNo}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
