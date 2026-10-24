"use client";

import { type ReactNode, useRef, useState } from "react";
import { SectionCard } from "@/components/forum/section-card";
import { MonthPicker } from "@/components/widgets/month-picker";
import { ViewAllLink } from "@/components/widgets/view-all-link";
import { cn } from "@/lib/utils";

// The part of the card that follows the month shown: the month's name, the link to its whole
// standing, and the list with how the points are counted.
export type MonthParts = { description: string; href: string; body: ReactNode };

// The card of the member-of-the-month widget. Choosing a month in its picker asks the server for
// that month's part of the card (`load`) and swaps it in, dimmed while it is on its way; the page
// around it stays as it is and its address does not change. When the server cannot draw the month
// the browser opens the month's own page, as the picker's form would without scripts.
//
//   parts   The month shown, as the server drew the card.
//   month   Its `YYYY-MM`.
//   picker  The months offered (`min` to `max`); none, no field.
//   load    A month's part of the card by its `YYYY-MM`; null when it cannot be drawn.
export function MonthStandingsCard({
  id,
  title,
  viewAll,
  parts,
  month,
  picker,
  load,
}: {
  id: string;
  title: string;
  viewAll: string;
  parts: MonthParts;
  month: string;
  picker?: { min: string; max: string };
  load: (month: string) => Promise<MonthParts | null>;
}) {
  // What was chosen, kept only while the server still draws the card it was chosen on: the month,
  // the part drawn for it (the last one drawn while the next is on its way) and whether it is.
  const [chosen, setChosen] = useState<{
    base: MonthParts;
    month: string;
    drawn: MonthParts | null;
    busy: boolean;
  } | null>(null);
  const asked = useRef(0);
  const own = chosen?.base === parts ? chosen : null;
  const shown = own?.drawn ?? parts;

  async function pick(next: string) {
    const ticket = ++asked.current;
    setChosen((now) => ({
      base: parts,
      month: next,
      drawn: now?.base === parts ? now.drawn : null,
      busy: true,
    }));
    let drawn: MonthParts | null = null;
    try {
      drawn = await load(next);
    } catch {
      drawn = null;
    }
    if (ticket !== asked.current) return;
    if (!drawn) {
      location.assign(`/members/month?month=${next}`);
      return;
    }
    setChosen({ base: parts, month: next, drawn, busy: false });
  }

  return (
    <SectionCard
      title={title}
      description={shown.description}
      action={<ViewAllLink href={shown.href}>{viewAll}</ViewAllLink>}
    >
      <div
        aria-live="polite"
        aria-busy={own?.busy || undefined}
        className={cn(
          "divide-y divide-border transition-opacity",
          own?.busy && "opacity-60",
        )}
      >
        {shown.body}
      </div>
      {picker && (
        <MonthPicker
          id={id}
          value={own?.month ?? month}
          min={picker.min}
          max={picker.max}
          className="px-4 py-3"
          onPick={pick}
        />
      )}
    </SectionCard>
  );
}
