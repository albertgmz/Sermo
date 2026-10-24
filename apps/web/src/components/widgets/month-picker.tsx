"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { FIELD_SURFACE } from "@/components/ui/field-surface";
import { Label } from "@/components/ui/label";
import { monthValue } from "@/components/widgets/month-range";
import { cn } from "@/lib/utils";

// The months from `max` back to `min`, newest first, with `value` kept in the list when it is
// outside them (an address can name any month).
function monthOptions(min: string, max: string, value?: string) {
  const months: string[] = [];
  const [minYear, minMonth] = min.split("-").map(Number);
  let [year, month] = max.split("-").map(Number);
  while (year > minYear || (year === minYear && month >= minMonth)) {
    months.push(monthValue(year, month));
    [year, month] = month === 1 ? [year - 1, 12] : [year, month - 1];
  }
  if (value && !months.includes(value)) months.push(value);
  return months.sort().reverse();
}

// Asks for the standing of a month: a select of the months by name. It is a plain form that opens
// `/members/month?month=YYYY-MM`, so it needs no script (its button is drawn only without one); with
// script, choosing a month asks at once: `onPick` is told, or else the form is sent, which the page
// around it (a `TabSwitch`) answers in place, with the address and the history following. `value`,
// `min` and `max` are months in that form. `compact`: the select takes the width of its months, not
// the row. Under it, what an older month shows.
export function MonthPicker({
  id,
  value,
  min,
  max,
  className,
  compact,
  onPick,
}: {
  id: string;
  value?: string;
  min: string;
  max: string;
  className?: string;
  compact?: boolean;
  onPick?: (month: string) => void;
}) {
  const t = useTranslations("widgetTypes.monthPicker");
  const format = useFormatter();
  return (
    <search className={className}>
      <form action="/members/month" className="flex gap-2">
        <Label htmlFor={id} className="sr-only">
          {t("label")}
        </Label>
        <select
          // Stays the same element when the month shown changes, so that the keyboard that chose
          // one stays on it; set to the month shown when it shows another (back, forward).
          ref={(node) => {
            if (node && value && node.value !== value) node.value = value;
          }}
          id={id}
          name="month"
          defaultValue={value}
          aria-describedby={`${id}-hint`}
          onChange={(event) =>
            onPick
              ? onPick(event.currentTarget.value)
              : event.currentTarget.form?.requestSubmit()
          }
          className={cn(
            FIELD_SURFACE,
            "h-10 min-w-0 rounded-lg px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:text-sm",
            !compact && "flex-1",
          )}
        >
          {monthOptions(min, max, value).map((month) => {
            const [year, number] = month.split("-").map(Number);
            return (
              <option key={month} value={month}>
                {format.dateTime(new Date(Date.UTC(year, number - 1, 1)), {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </option>
            );
          })}
        </select>
        <noscript>
          <Button type="submit" className="h-10 md:h-8">
            {t("submit")}
          </Button>
        </noscript>
      </form>
      <p
        id={`${id}-hint`}
        className="mt-2 text-xs text-pretty text-muted-foreground"
      >
        {t("hint")}
      </p>
    </search>
  );
}
