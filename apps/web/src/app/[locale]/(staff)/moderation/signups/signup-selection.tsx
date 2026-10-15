"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DecideControls } from "./signup-controls";

type Selection = {
  selected: ReadonlySet<number>;
  toggle: (id: number) => void;
};
const SelectionContext = createContext<Selection | null>(null);

// The ticked ids that are still on the page: after a decision or a move to another page the ones
// that left are dropped, so the count never exceeds what is shown.
export const onPage = (
  ticked: ReadonlySet<number>,
  pageIds: readonly number[],
): ReadonlySet<number> => new Set(pageIds.filter((id) => ticked.has(id)));

// The tick beside a sign-up of the list. Outside a `SignupSelection` it draws nothing.
export function SignupTick({ id, name }: { id: number; name: string }) {
  const t = useTranslations("moderation.signups");
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <div className="flex shrink-0 items-start pt-1">
      <Checkbox
        checked={selection.selected.has(id)}
        onCheckedChange={() => selection.toggle(id)}
        aria-label={t("select", { name })}
      />
    </div>
  );
}

// The list's rows can be ticked; the bar under it approves or rejects the ticked ones. The
// backend judges each account again, so the ticks are only a way to name them.
export function SignupSelection({
  pageIds,
  children,
}: {
  pageIds: readonly number[];
  children: React.ReactNode;
}) {
  const t = useTranslations("moderation.signups");
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const selected = onPage(ticked, pageIds);
  const toggle = (id: number) =>
    setTicked(() => {
      const next = new Set(selected);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <SelectionContext value={{ selected, toggle }}>
      {children}
      {pageIds.length > 0 && (
        <section
          aria-label={t("bar")}
          className="sticky bottom-20 z-20 mt-3 max-h-[70dvh] space-y-2 overflow-y-auto rounded-lg border bg-card p-3 shadow-lg md:bottom-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="mr-auto text-sm font-medium">
              {t("selected", { count: selected.size })}
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-3"
              onClick={() => setTicked(new Set(pageIds))}
            >
              {t("selectAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-10 px-3"
              disabled={selected.size === 0}
              onClick={() => setTicked(new Set())}
            >
              {t("clear")}
            </Button>
          </div>
          {selected.size > 0 && <DecideControls userIds={[...selected]} />}
        </section>
      )}
    </SelectionContext>
  );
}
