"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { monthValue } from "@/components/widgets/month-range";

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
// `/members/month?month=YYYY-MM`, so it needs no script; with script, choosing a month opens it at
// once, in place (only the standing changes; the address and the history follow). `value`, `min`
// and `max` are months in that form. Under it, what an older month shows.
export function MonthPicker({
  id,
  value,
  min,
  max,
  className,
}: {
  id: string;
  value?: string;
  min: string;
  max: string;
  className?: string;
}) {
  const t = useTranslations("widgetTypes.monthPicker");
  const format = useFormatter();
  const router = useRouter();
  return (
    <search className={className}>
      <form action="/members/month" className="flex gap-2">
        <Label htmlFor={id} className="sr-only">
          {t("label")}
        </Label>
        <select
          key={value}
          id={id}
          name="month"
          defaultValue={value}
          aria-describedby={`${id}-hint`}
          onChange={(event) =>
            router.push(`/members/month?month=${event.currentTarget.value}`)
          }
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8 md:text-sm dark:bg-input/30"
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
        <Button type="submit" className="h-10 md:h-8">
          {t("submit")}
        </Button>
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
