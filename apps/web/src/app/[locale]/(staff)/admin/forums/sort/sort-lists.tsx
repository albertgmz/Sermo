"use client";

// The sort page's form: one list per parent under a single Save. It is the sort pattern
// (`SortForm`) with several lists, built on the same helpers: an entry moves only within its group,
// and only the entries that moved are sent with a new number. The text is the pattern's
// (`admin.sortForm`).
//
// Props
//   action    The tree's order action. It reads every `position:<id>` against its `before:<id>`.
//   heading   The panel's heading.
//   groups    The groups in display order: `id`, `heading` and `items` (`id`, `title`, `position`,
//             `description`, in ascending `position`).

import { ChevronDown, ChevronUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { FormRows, type StaffFormState } from "@/components/staff/form-rows";
import { focusKeeper } from "@/components/staff/sort-order";
import { Button } from "@/components/ui/button";
import { groupPositions, moveInGroup, type OrderEntry } from "./group-order";

export type SortList = {
  id: string;
  heading: string;
  items: (OrderEntry & { title: string; description: string })[];
};

export function SortLists({
  action,
  heading,
  groups,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  heading: React.ReactNode;
  groups: SortList[];
}) {
  const t = useTranslations("admin.sortForm");
  return (
    <FormRows action={action} heading={heading} submit={t("save")}>
      {/* New entries or numbers from the backend start the order afresh. */}
      <Lists
        key={groups
          .flatMap((group) =>
            group.items.map((item) => `${item.id}:${item.position}`),
          )
          .join()}
        groups={groups}
      />
    </FormRows>
  );
}

function Lists({ groups }: { groups: SortList[] }) {
  const t = useTranslations("admin.sortForm");
  const [order, setOrder] = useState(groups);
  const [said, setSaid] = useState("");
  const [keeper] = useState(focusKeeper<HTMLButtonElement>);
  // After every draw: a move asked for its arrow back.
  useLayoutEffect(() => keeper.restore());
  const positions = groupPositions(order, groups);
  const move = (group: SortList, index: number, by: -1 | 1) => {
    const target = index + by;
    if (target < 0 || target >= group.items.length) return;
    const entry = group.items[index];
    keeper.want(`${entry.id}:${by}`);
    setOrder(moveInGroup(order, group.id, index, by));
    setSaid(t("moved", { title: entry.title, position: target + 1 }));
  };
  return (
    <>
      {order.map((group) => (
        <section key={group.id} aria-label={group.heading}>
          <h3 className="bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground [overflow-wrap:anywhere]">
            {group.heading}
          </h3>
          <ol className="divide-y">
            {group.items.map((item, index) => (
              <li
                key={item.id}
                className="flex min-h-14 items-center gap-3 px-4 py-2"
              >
                <input
                  type="hidden"
                  name={`position:${item.id}`}
                  value={positions.get(item.id)}
                />
                <input
                  type="hidden"
                  name={`before:${item.id}`}
                  value={item.position}
                />
                <input
                  type="hidden"
                  name={`title:${item.id}`}
                  value={item.title}
                />
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {item.title}
                  </p>
                  <div className="text-xs text-muted-foreground">
                    {item.description}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Arrow
                    ref={keeper.ref(`${item.id}:-1`)}
                    label={t("up", { title: item.title })}
                    end={index === 0}
                    onMove={() => move(group, index, -1)}
                  >
                    <ChevronUp />
                  </Arrow>
                  <Arrow
                    ref={keeper.ref(`${item.id}:1`)}
                    label={t("down", { title: item.title })}
                    end={index === group.items.length - 1}
                    onMove={() => move(group, index, 1)}
                  >
                    <ChevronDown />
                  </Arrow>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </>
  );
}

// At the end of a list the arrow stays focusable (marked disabled), so the focus given back to it
// after a move to the end is not lost.
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
