"use client";

// The navigation list: every entry of every place as a tree (top-level entries as heading rows,
// their children indented), with a filter and the order form. The order inputs sit in their rows
// and belong to the order form through its id, so one submit sends them all; rows the filter
// hides keep their inputs.
//
// Props
//   places       The places in display order, each with its tree.
//   permissions  Global permission ids for the audience select, or null for a typed field.

import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmStep } from "@/components/staff/confirm-step";
import type { StaffFormState } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteEntry, saveEntry, saveOrder } from "./actions";

export type Item = {
  id: number;
  title: string;
  target: string | null;
  builtin: boolean;
  isEnabled: boolean;
  audience: string;
  permission: string | null;
  position: number;
  // For a top-level entry: how many children it has, and how many are on.
  children: number;
  enabledChildren: number;
};
export type Place = {
  location: string;
  label: string;
  tree: { entry: Item; children: Item[] }[];
};

const AUDIENCES = ["everyone", "guests", "members", "permission"] as const;

function OrderButton() {
  const t = useTranslations("adminSetup.navigation.order");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {pending ? t("saving") : t("submit")}
    </Button>
  );
}

function SaveButton() {
  const t = useTranslations("adminSetup.navigation.row");
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      disabled={pending}
      className="min-h-10 px-4"
    >
      {pending ? t("saving") : t("save")}
    </Button>
  );
}

function Row({
  item,
  child,
  permissions,
  hidden,
}: {
  item: Item;
  child: boolean;
  permissions: string[] | null;
  hidden: boolean;
}) {
  const t = useTranslations("adminSetup.navigation");
  const [state, action] = useActionState(saveEntry, null as StaffFormState);
  const id = useId();
  const knownAudience = (AUDIENCES as readonly string[]).includes(
    item.audience,
  );
  const empty =
    !child &&
    (item.target === null || item.children > 0) &&
    item.enabledChildren === 0;
  return (
    <li
      hidden={hidden}
      className={
        child
          ? "space-y-3 border-l-2 py-3 pr-4 pl-4 sm:ml-6"
          : "space-y-3 bg-muted/30 p-4"
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <p
          className={
            child
              ? "text-sm [overflow-wrap:anywhere]"
              : "text-sm font-semibold [overflow-wrap:anywhere]"
          }
        >
          {item.title}
        </p>
        {item.builtin && <Badge variant="secondary">{t("row.builtin")}</Badge>}
        {!item.isEnabled && (
          <Badge variant="outline">{t("row.disabled")}</Badge>
        )}
        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {item.target === null
            ? t("row.heading")
            : t("row.target", { target: item.target })}
        </span>
      </div>
      {empty && (
        <p className="text-xs text-muted-foreground">{t("row.noChildren")}</p>
      )}
      <form
        action={action}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[6rem_minmax(0,1fr)_12rem_12rem_auto_auto]"
      >
        <input type="hidden" name="id" value={item.id} />
        <div className="space-y-1">
          <label htmlFor={`${id}-order`} className="text-xs font-medium">
            {t("row.order")}
          </label>
          <Input
            id={`${id}-order`}
            form="order"
            name={`position.${item.id}`}
            type="number"
            inputMode="numeric"
            defaultValue={item.position}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-title`} className="text-xs font-medium">
            {t("row.title")}
          </label>
          <Input
            id={`${id}-title`}
            name="title"
            required
            defaultValue={item.title}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-audience`} className="text-xs font-medium">
            {t("row.audience")}
          </label>
          <select
            id={`${id}-audience`}
            name="audience"
            defaultValue={item.audience}
            className={selectClass}
          >
            {AUDIENCES.map((value) => (
              <option key={value} value={value}>
                {t(`audiences.${value}`)}
              </option>
            ))}
            {!knownAudience && (
              <option value={item.audience}>{item.audience}</option>
            )}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-permission`} className="text-xs font-medium">
            {t("row.permission")}
          </label>
          {permissions ? (
            <select
              id={`${id}-permission`}
              name="permission"
              defaultValue={item.permission ?? ""}
              className={selectClass}
            >
              <option value="">{t("add.noPermission")}</option>
              {permissions.map((permission) => (
                <option key={permission} value={permission}>
                  {permission}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id={`${id}-permission`}
              name="permission"
              autoCapitalize="none"
              defaultValue={item.permission ?? ""}
            />
          )}
        </div>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            name="isEnabled"
            defaultChecked={item.isEnabled}
            aria-label={t("row.enabledLabel", { title: item.title })}
            className="size-5"
          />
          {t("row.enabled")}
        </label>
        <div className="self-end">
          <SaveButton />
        </div>
        <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden sm:col-span-2 lg:col-span-full">
          {[state?.error, ...Object.values(state?.fields ?? {})]
            .filter(Boolean)
            .join(" ")}
        </output>
      </form>
      {!item.builtin && (
        <ConfirmStep
          action={deleteEntry}
          fields={{ id: String(item.id) }}
          summary={t("row.delete")}
          warning={t("row.deleteWarning", { title: item.title })}
          submit={t("row.deleteConfirm")}
        />
      )}
    </li>
  );
}

export function Entries({
  places,
  permissions,
}: {
  places: Place[];
  permissions: string[] | null;
}) {
  const t = useTranslations("adminSetup.navigation");
  const [state, orderAction] = useActionState(
    saveOrder,
    null as StaffFormState,
  );
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (item: Item) => item.title.toLowerCase().includes(needle);
  const shown = (entry: Item, children: Item[]) =>
    !needle || matches(entry) || children.some(matches);
  const anyShown = places.some((place) =>
    place.tree.some(({ entry, children }) => shown(entry, children)),
  );
  const empty = places.every((place) => place.tree.length === 0);
  return (
    <section className="min-w-0 rounded-lg border bg-card">
      <div className="space-y-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("order.heading")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("order.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
            <label htmlFor="navigation-filter" className="text-xs font-medium">
              {t("filter.label")}
            </label>
            <Input
              id="navigation-filter"
              type="search"
              value={query}
              placeholder={t("filter.placeholder")}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <form id="order" action={orderAction}>
            <OrderButton />
          </form>
        </div>
        <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
          {state?.error}
        </output>
      </div>
      {empty && <p className="p-4 text-sm">{t("row.empty")}</p>}
      {needle && !anyShown && (
        <p className="p-4 text-sm text-muted-foreground">{t("filter.none")}</p>
      )}
      {places.map((place) => (
        <div
          key={place.location}
          hidden={
            place.tree.length === 0 ||
            !place.tree.some(({ entry, children }) => shown(entry, children))
          }
          className="border-b last:border-b-0"
        >
          <h3 className="border-b px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {place.label}
          </h3>
          <ul className="divide-y">
            {place.tree.map(({ entry, children }) => (
              <li key={entry.id} hidden={!shown(entry, children)}>
                <ul>
                  <Row
                    item={entry}
                    child={false}
                    permissions={permissions}
                    hidden={false}
                  />
                  {children.map((child) => (
                    <Row
                      key={child.id}
                      item={child}
                      child
                      permissions={permissions}
                      hidden={
                        Boolean(needle) && !matches(child) && !matches(entry)
                      }
                    />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
