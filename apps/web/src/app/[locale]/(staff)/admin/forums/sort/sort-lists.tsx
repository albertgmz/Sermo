"use client";

// The sort page's form: one list per parent under a single Save. It is the sort pattern
// (`SortForm`) with several lists, built on the same rows (`SortRow`) and helpers: an entry moves
// only within its group, and only the entries that moved are sent with a new number. The text is
// the pattern's (`admin.sortForm`).
//
// Props
//   action    The tree's order action. It reads every `position:<id>` against its `before:<id>`.
//   heading   The panel's heading.
//   groups    The groups in display order: `id`, `heading` and `items` (`id`, `title`, `position`,
//             `description`, in ascending `position`).

import { useTranslations } from "next-intl";
import { useLayoutEffect, useState } from "react";
import { FormRows, type StaffFormState } from "@/components/staff/form-rows";
import { SortRow } from "@/components/staff/sort-form";
import { focusKeeper } from "@/components/staff/sort-order";
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
              <SortRow
                key={item.id}
                id={item.id}
                place={index}
                count={group.items.length}
                title={item.title}
                description={item.description}
                keeper={keeper}
                onMove={(by) => move(group, index, by)}
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
              </SortRow>
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
