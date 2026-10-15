"use client";

// RowSelection: the tick beside each row of a list, and a sticky bar under the list that acts on
// the ticked rows. The thread batch and the sign-up queue use it; each draws its own bar, the
// shared part is which rows are ticked and the controls every bar starts with.
//
// RowSelection   Provider. `bar` draws the bar from the selection it is given (and decides when
//                to show it). `pageIds` are the rows the list shows when the server knows them all:
//                a tick of a row that left the list (decided, deleted, another page) no longer
//                counts, and the bar may offer "select all". Leave it out for a list that grows
//                on the client, where no such filtering is possible.
// RowTick        The checkbox of one row; draws nothing outside a RowSelection, so a row need not
//                know whether the viewer may act on it. `label` is its accessible name.
// SelectionHeader  The bar's first line: how many are ticked, "select all" when offered, "clear".
// selectionBarClass  The bar's sticky container: above the bottom navigation on a phone.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type SelectionApi = {
  selected: ReadonlySet<number>;
  toggle: (id: number) => void;
  // Ticks every row of `pageIds`; undefined when the list gave none.
  selectAll: (() => void) | undefined;
  clear: () => void;
};

const SelectionContext = createContext<SelectionApi | null>(null);

// The ticked ids that are still among `pageIds` (all of them when there are none to compare).
export const onPage = (
  ticked: ReadonlySet<number>,
  pageIds: readonly number[] | undefined,
): ReadonlySet<number> =>
  pageIds === undefined
    ? ticked
    : new Set(pageIds.filter((id) => ticked.has(id)));

export const selectionBarClass =
  "sticky bottom-20 z-20 mt-3 rounded-lg border bg-card shadow-lg md:bottom-4";

export function RowSelection({
  pageIds,
  children,
  bar,
}: {
  pageIds?: readonly number[];
  children: React.ReactNode;
  bar: (selection: SelectionApi) => React.ReactNode;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const selected = onPage(ticked, pageIds);
  const toggle = useCallback(
    (id: number) =>
      setTicked(() => {
        const next = new Set(selected);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [selected],
  );
  const clear = useCallback(() => setTicked(new Set()), []);
  const selectAll = useMemo(
    () => (pageIds ? () => setTicked(new Set(pageIds)) : undefined),
    [pageIds],
  );
  const api: SelectionApi = { selected, toggle, selectAll, clear };
  return (
    <SelectionContext value={api}>
      {children}
      {bar(api)}
    </SelectionContext>
  );
}

export function RowTick({
  id,
  label,
  className,
}: {
  id: number;
  label: string;
  className?: string;
}) {
  const selection = useContext(SelectionContext);
  if (!selection) return null;
  return (
    <div className={cn("flex shrink-0", className)}>
      <Checkbox
        checked={selection.selected.has(id)}
        onCheckedChange={() => selection.toggle(id)}
        aria-label={label}
      />
    </div>
  );
}

export function SelectionHeader({
  selection,
  countLabel,
  selectAllLabel,
  clearLabel,
}: {
  selection: SelectionApi;
  // The sentence saying how many are ticked.
  countLabel: string;
  selectAllLabel?: string;
  clearLabel: string;
}) {
  const { selected, selectAll, clear } = selection;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role="status" className="mr-auto text-sm font-medium">
        {countLabel}
      </p>
      {selectAll && selectAllLabel && (
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={selectAll}
        >
          {selectAllLabel}
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-10 px-3"
        disabled={selected.size === 0}
        onClick={clear}
      >
        {clearLabel}
      </Button>
    </div>
  );
}
