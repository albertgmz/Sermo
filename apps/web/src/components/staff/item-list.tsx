"use client";

// The list pattern of the panel: a card of clean rows, each leading to its own edit page.
//
// ItemList props
//   label        The list's accessible name (and the filter box's).
//   heading      Optional heading of the card; `description` an optional line under it.
//   items        The rows, as `ItemRow` props plus `id` (the row's key) and `search`.
//   filter       true shows a filter box above the rows: it narrows the rows already on the page
//                to those whose `search` text (default: the title, when it is text) holds what was
//                typed, ignoring case and accents. Lists the backend pages through keep their own
//                search form instead.
//   empty        What shows when there are no rows: `title`, optional `description` and `action`
//                (e.g. an "Add" link).
// A footer says how many rows show ("Showing 4 of 12" while filtered).
//
// ItemRow props (also usable on its own, inside any `ul`)
//   icon         Optional picture or icon, in a 40 px box.
//   title        The row's name; with `href`, the link to its edit page.
//   description  Optional short description or key, under the title.
//   badges       Optional badges after the title.
//   toggle       Optional switch, usually a `RowToggle`.
//   actions      Optional controls at the end of the row: `RowLink`s, a delete step.
//
// RowToggle: an on/off switch that submits an existing action at once.
//   action   (previous, formData) => Promise<StaffFormState>, the action the screen already has.
//   fields   The hidden fields the action reads (the record's id, the state to set).
//   checked  The state shown now.
//   label    What the switch turns on or off, read out with its state.
//
// RowLink: an icon button that is a link: the row's "Edit" (`icon`, an element such as
// `<Eye />`, defaults to a pencil).

import { Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useId, useState } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StaffFormState } from "./form-rows";

export type ItemRowProps = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  href?: string;
  description?: React.ReactNode;
  badges?: React.ReactNode;
  toggle?: React.ReactNode;
  actions?: React.ReactNode;
};

export type Item = ItemRowProps & { id: string | number; search?: string };

// Lower case, accents dropped: "Éxito" is found by "exito".
const folded = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

export function matches(item: Item, query: string) {
  const wanted = folded(query.trim());
  if (wanted === "") return true;
  const text =
    item.search ?? (typeof item.title === "string" ? item.title : "");
  return folded(text).includes(wanted);
}

export function ItemList({
  label,
  heading,
  description,
  items,
  filter,
  empty,
}: {
  label: string;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  items: Item[];
  filter?: boolean;
  empty: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
}) {
  const t = useTranslations("admin.itemList");
  const [query, setQuery] = useState("");
  const filterId = useId();
  const shown = filter ? items.filter((item) => matches(item, query)) : items;
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      {heading && (
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{heading}</h2>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState title={empty.title} description={empty.description}>
          {empty.action}
        </EmptyState>
      ) : (
        <>
          {filter && (
            <div className="relative border-b p-3">
              <label htmlFor={filterId} className="sr-only">
                {t("filter")}
              </label>
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-5.5 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id={filterId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("filterPlaceholder")}
                aria-controls={`${filterId}-list`}
                className="pl-8"
              />
            </div>
          )}
          {shown.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground [overflow-wrap:anywhere]">
              {t("noMatch", { query: query.trim() })}
            </p>
          ) : (
            <ul id={`${filterId}-list`} aria-label={label} className="divide-y">
              {shown.map((item) => (
                <ItemRow key={item.id} {...item} />
              ))}
            </ul>
          )}
          <p
            aria-live="polite"
            className="border-t px-4 py-2.5 text-xs text-muted-foreground"
          >
            {shown.length === items.length
              ? t("shown", { count: items.length })
              : t("shownOf", { shown: shown.length, total: items.length })}
          </p>
        </>
      )}
    </section>
  );
}

export function ItemRow({
  icon,
  title,
  href,
  description,
  badges,
  toggle,
  actions,
}: ItemRowProps) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-4 py-2">
      {icon && (
        <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1 py-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {href ? (
            <Link
              href={href}
              className="text-sm font-medium underline-offset-4 [overflow-wrap:anywhere] hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {title}
            </Link>
          ) : (
            <span className="text-sm font-medium [overflow-wrap:anywhere]">
              {title}
            </span>
          )}
          {badges}
        </div>
        {description && (
          <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {description}
          </div>
        )}
      </div>
      {(toggle || actions) && (
        <div className="flex shrink-0 items-center gap-1">
          {toggle}
          {actions}
        </div>
      )}
    </li>
  );
}

export function RowToggle({
  action,
  fields,
  checked,
  label,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields: Record<string, string>;
  checked: boolean;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col items-end">
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button
        type="submit"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={pending}
        className="group inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className="flex h-5 w-9 items-center rounded-full border border-input bg-muted p-0.5 transition-colors group-aria-checked:border-primary group-aria-checked:bg-primary">
          <span className="size-3.5 rounded-full bg-muted-foreground transition-transform group-aria-checked:translate-x-4 group-aria-checked:bg-primary-foreground" />
        </span>
      </button>
      {state?.error && (
        <p
          role="alert"
          className="max-w-48 text-right text-xs text-destructive [overflow-wrap:anywhere]"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}

export function RowLink({
  href,
  label,
  icon = <Pencil />,
}: {
  href: string;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(
        buttonVariants({ variant: "ghost", size: "icon" }),
        "size-10",
      )}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
    </Link>
  );
}
