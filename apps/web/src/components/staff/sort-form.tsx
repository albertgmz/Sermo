"use client";

// SortForm: the sort page's form. The entries in their current order, each with up and down
// arrows, and one Save that hands the new order to an order action the screen already has (no
// drag and drop). Built on `FormRows`, so a refusal shows the same way.
//
// Props
//   action       (previous, formData) => Promise<StaffFormState>: the existing order action.
//   name         The field each entry's position is sent in, with `{id}` for the entry's id:
//                "position.{id}" or "position:{id}", as the action reads it.
//   items        The entries in their current order (by ascending `position`, as the backend
//                lists them): `id`, `title`, `position` (the number the
//                backend holds), optional `icon` and `description`, and optional `fields`, hidden
//                fields the action reads besides the position (e.g. `before:<id>` and `title:<id>`).
//   heading      The panel's heading; `description` an optional line under it.
//   submit       Label of the save button. Default: "Save order".
// Only entries that moved get a new number when the backend's numbers allow it
// (`positionsFor`), so the action saves only those. After a move the keyboard stays on the arrow
// that was pressed, on the entry in its new place (`focusKeeper`), and the move is read out.

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormRows, type StaffFormState } from "./form-rows";
import { focusKeeper, moved, positionsFor } from "./sort-order";

export type SortItem = {
  id: number | string;
  title: string;
  position: number;
  icon?: React.ReactNode;
  description?: React.ReactNode;
  fields?: Record<string, string | number>;
};

export function SortForm({
  action,
  name,
  items,
  heading,
  description,
  submit,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  name: string;
  items: SortItem[];
  heading: React.ReactNode;
  description?: React.ReactNode;
  submit?: string;
}) {
  const t = useTranslations("admin.sortForm");
  return (
    <FormRows
      action={action}
      heading={heading}
      description={description}
      submit={submit ?? t("save")}
    >
      {/* New entries or numbers from the backend start the order afresh. */}
      <SortRows
        key={items.map((item) => `${item.id}:${item.position}`).join()}
        name={name}
        items={items}
      />
    </FormRows>
  );
}

function SortRows({ name, items }: { name: string; items: SortItem[] }) {
  const t = useTranslations("admin.sortForm");
  const [order, setOrder] = useState(items);
  const [said, setSaid] = useState("");
  const [keeper] = useState(focusKeeper<HTMLButtonElement>);
  // After every draw: a move asked for its arrow back.
  useLayoutEffect(() => keeper.restore());
  const positions = positionsFor(order);
  const move = (index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= order.length) return;
    keeper.want(`${order[index].id}:${by}`);
    setOrder(moved(order, index, by));
    setSaid(t("moved", { title: order[index].title, position: target + 1 }));
  };
  return (
    <>
      <ol className="divide-y">
        {order.map((item, index) => (
          <li
            key={item.id}
            className="flex min-h-14 items-center gap-3 px-4 py-2"
          >
            <input
              type="hidden"
              name={name.replace("{id}", String(item.id))}
              value={positions[index]}
            />
            {Object.entries(item.fields ?? {}).map(([field, value]) => (
              <input key={field} type="hidden" name={field} value={value} />
            ))}
            <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            {item.icon && (
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden">
                {item.icon}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium [overflow-wrap:anywhere]">
                {item.title}
              </p>
              {item.description && (
                <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {item.description}
                </div>
              )}
            </div>
            <div className="flex shrink-0 gap-1">
              <Arrow
                ref={keeper.ref(`${item.id}:-1`)}
                label={t("up", { title: item.title })}
                end={index === 0}
                onMove={() => move(index, -1)}
              >
                <ChevronUp />
              </Arrow>
              <Arrow
                ref={keeper.ref(`${item.id}:1`)}
                label={t("down", { title: item.title })}
                end={index === order.length - 1}
                onMove={() => move(index, 1)}
              >
                <ChevronDown />
              </Arrow>
            </div>
          </li>
        ))}
      </ol>
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  );
}

// At the end of the list the arrow stays focusable (marked disabled), so the focus given back to
// it after a move to the end is not lost.
function Arrow({
  ref,
  label,
  end,
  onMove,
  children,
}: {
  ref: (node: HTMLButtonElement | null) => void;
  label: string;
  end: boolean;
  onMove: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-disabled={end || undefined}
      onClick={onMove}
      className="size-10 aria-disabled:opacity-40"
    >
      {children}
    </Button>
  );
}
