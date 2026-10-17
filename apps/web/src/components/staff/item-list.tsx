"use client";

// The list pattern of the panel: a card of clean rows, each leading to its own edit page.
//
// ItemList props
//   label        The list's accessible name. Pass the same text as `heading` when there is one;
//                without a heading it is the only name the list has.
//   heading      Optional heading of the card; `description` an optional line under it, `action`
//                an optional control at its end (the "Add" of a list that is not the page's own).
//   items        The rows, as `ItemRow` props plus `id` (the row's key) and `search`.
//   filter       true shows a filter box above the rows: it narrows the rows already on the page
//                to those whose `search` text (default: the title, when it is text) holds what was
//                typed, ignoring case and accents. Lists the backend pages through keep their own
//                search form instead.
//   empty        What shows when there are no rows: `title`, optional `description` and `action`
//                (e.g. an "Add" link).
//   paging       Optional `Paging` (paging.tsx) of a list the backend pages by cursor: its links
//                ("Back to the first page", "Next") go in the footer.
// A footer says how many rows show ("Showing 4 of 12" while filtered, "12 on this page" on a list
// with more than one page).
//
// ItemRow props (also usable on its own, inside any `ul`)
//   icon         Optional picture or icon, in a 40 px box that does not clip it (a frame may
//                overhang an avatar; a tick keeps its focus ring).
//   title        The row's name; with `href`, the link to its edit page.
//   description  Optional short description or key, under the title.
//   badges       Optional badges after the title.
//   toggle       Optional switch, a `RowToggle`.
//   actions      Optional short controls at the end of the row: `RowLink`s and closed
//                `ConfirmStep`s (a delete). A step that opens, and a toggle asking to confirm,
//                take the row's whole width on a line of their own, under the title.
//   panel        Optional content that is always a line of its own under the row (a note, a
//                small form).
// When the title would get narrower than 10rem beside the controls (a phone), the controls go to a
// line of their own under it.
//
// RowToggle: an on/off switch for an existing action that reads the new state as "1" (on) or "0"
// (off).
//   action   (previous, formData) => Promise<StaffFormState>, the action the screen already has.
//   fields   The other hidden fields the action reads (the record's id).
//   field    The name of the state field. Default: "active". The switch sends the flipped state.
//   checked  The state shown now.
//   label    What the switch turns on or off, read out with its state.
//   confirm  Optional `{ warning?, submit, danger? }`: the switch first opens a step under the row
//            with the warning, a confirm button (`submit`; destructive with `danger`) and Cancel,
//            as the panel's activate and deactivate steps do. Without it the switch submits at once.
//            A refused save keeps the step open; a save that goes through (a notice, or the page
//            drawn again with the flipped state) closes it and gives the focus back to the switch
//            (`keepsAsking`).
// The action's refusal or notice shows under the row.
//
// RowLink: an icon button that is a link: the row's "Edit" (`icon`, an element such as
// `<Eye />`, defaults to a pencil).

import { Pencil, Search } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { StaffFormState } from "./form-rows";
import { hasPages, type Paging, PagingLinks } from "./paging";
import { SubmitButton } from "./submit-button";

export type ItemRowProps = {
  icon?: React.ReactNode;
  title: React.ReactNode;
  href?: string;
  description?: React.ReactNode;
  badges?: React.ReactNode;
  toggle?: React.ReactNode;
  actions?: React.ReactNode;
  panel?: React.ReactNode;
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
  action,
  items,
  filter,
  empty,
  paging,
}: {
  label: string;
  heading?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  items: Item[];
  filter?: boolean;
  empty: {
    title: string;
    description?: string;
    action?: React.ReactNode;
  };
  paging?: Paging;
}) {
  const t = useTranslations("admin.itemList");
  const [query, setQuery] = useState("");
  const filterId = useId();
  const shown = filter ? items.filter((item) => matches(item, query)) : items;
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border bg-card">
      {heading && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b p-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{heading}</h2>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {items.length === 0 ? (
        <>
          <EmptyState title={empty.title} description={empty.description}>
            {empty.action}
          </EmptyState>
          {paging && <PagingLinks {...paging} className="border-t p-4" />}
        </>
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
                aria-controls={
                  shown.length > 0 ? `${filterId}-list` : undefined
                }
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
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-4 py-2.5">
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {shown.length !== items.length
                ? t("shownOf", { shown: shown.length, total: items.length })
                : paging && hasPages(paging)
                  ? t("shownOnPage", { count: items.length })
                  : t("shown", { count: items.length })}
            </p>
            {paging && <PagingLinks {...paging} />}
          </div>
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
  panel,
}: ItemRowProps) {
  return (
    <li className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
      {icon && (
        <span className="flex size-10 shrink-0 items-center justify-center">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-[1_1_10rem] py-1">
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
        // An open step (a `ConfirmStep`, a toggle asking) takes the row's width.
        <div className="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1 has-[[data-asking]]:basis-full has-[details[open]]:basis-full">
          {toggle}
          {actions}
        </div>
      )}
      {panel && <div className="min-w-0 basis-full">{panel}</div>}
    </li>
  );
}

// What a RowToggle's confirm step saw last: the action's state and the switch's.
type Settled = { state: StaffFormState; checked: boolean };

// Whether an open confirm step stays open from `before` to `now`: while nothing has settled, and
// after a refused save. A save that went through closes it, whether the action came back without an
// error or the page was drawn again with the switch flipped.
export function keepsAsking(before: Settled, now: Settled): boolean {
  if (now.checked !== before.checked) return false;
  if (now.state === before.state) return true;
  return Boolean(now.state?.error);
}

export function RowToggle({
  action,
  fields,
  field = "active",
  checked,
  label,
  confirm,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields: Record<string, string>;
  field?: string;
  checked: boolean;
  label: string;
  confirm?: { warning?: string; submit: string; danger?: boolean };
}) {
  const t = useTranslations("admin.itemList");
  const [state, formAction, pending] = useActionState(action, null);
  const [asking, setAsking] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const step = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  // The step opens on Cancel, the safe choice, not on the button that saves.
  useEffect(() => {
    if (asking) cancel.current?.focus();
  }, [asking]);
  const settled = useRef<Settled>({ state, checked });
  // Each time a save settles: close the step (when it is open) unless the save was refused.
  useEffect(() => {
    const before = settled.current;
    settled.current = { state, checked };
    if (!step.current || keepsAsking(before, { state, checked })) return;
    setAsking(false);
    toggle.current?.focus();
  }, [state, checked]);
  const message = state?.error ?? state?.notice;
  return (
    <form
      action={formAction}
      // Private to the row: Base UI marks its own popups `data-open`.
      data-asking={asking || message ? "" : undefined}
      className="flex flex-wrap items-center justify-end gap-2 data-asking:basis-full"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name={field} value={checked ? "0" : "1"} />
      <button
        ref={toggle}
        type={confirm ? "button" : "submit"}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={pending}
        onClick={confirm ? () => setAsking((open) => !open) : undefined}
        className="group inline-flex size-10 items-center justify-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        <span className="flex h-5 w-9 items-center rounded-full border border-input bg-muted p-0.5 transition-colors group-aria-checked:border-primary group-aria-checked:bg-primary">
          <span className="size-3.5 rounded-full bg-muted-foreground transition-transform group-aria-checked:translate-x-4 group-aria-checked:bg-primary-foreground" />
        </span>
      </button>
      {confirm && asking && (
        <div
          ref={step}
          className="basis-full space-y-3 rounded-md border p-3 text-left"
        >
          {confirm.warning && (
            <p className="text-sm text-pretty">{confirm.warning}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <SubmitButton
              label={confirm.submit}
              variant={confirm.danger ? "destructive" : "default"}
            />
            <Button
              ref={cancel}
              type="button"
              variant="ghost"
              className="min-h-10 px-4"
              onClick={() => {
                setAsking(false);
                toggle.current?.focus();
              }}
            >
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      <output
        className={cn(
          "block basis-full text-right text-xs font-medium [overflow-wrap:anywhere] empty:hidden",
          state?.error ? "text-destructive" : "text-success",
        )}
      >
        {message}
      </output>
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
