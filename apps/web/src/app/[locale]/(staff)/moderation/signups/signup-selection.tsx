"use client";

import { useTranslations } from "next-intl";
import {
  RowSelection,
  RowTick,
  SelectionHeader,
  selectionBarClass,
} from "@/components/staff/row-selection";
import { cn } from "@/lib/utils";
import type { RejectOptions } from "./reject-options";
import { DecideControls } from "./signup-controls";

// The tick beside a sign-up of the list. Outside a `SignupSelection` it draws nothing.
export function SignupTick({ id, name }: { id: number; name: string }) {
  const t = useTranslations("moderation.signups");
  return (
    <RowTick
      id={id}
      label={t("select", { name })}
      className="items-start pt-1"
    />
  );
}

// The list's rows can be ticked; the bar under it approves or rejects the ticked ones. The
// backend judges each account again, so the ticks are only a way to name them. Only ticks of the
// accounts the page still lists count: after a decision the ones that left drop out.
export function SignupSelection({
  pageIds,
  options,
  children,
}: {
  pageIds: readonly number[];
  options: RejectOptions;
  children: React.ReactNode;
}) {
  const t = useTranslations("moderation.signups");
  return (
    <RowSelection
      pageIds={pageIds}
      bar={(selection) =>
        pageIds.length > 0 && (
          <section
            aria-label={t("bar")}
            className={cn(
              selectionBarClass,
              "max-h-[70dvh] space-y-2 overflow-y-auto p-3",
            )}
          >
            <SelectionHeader
              selection={selection}
              countLabel={t("selected", { count: selection.selected.size })}
              selectAllLabel={t("selectAll")}
              clearLabel={t("clear")}
            />
            {selection.selected.size > 0 && (
              <DecideControls
                userIds={[...selection.selected]}
                options={options}
              />
            )}
          </section>
        )
      }
    >
      {children}
    </RowSelection>
  );
}
