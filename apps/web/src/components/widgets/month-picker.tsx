import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A month as the value of a month field: `YYYY-MM`.
export const monthValue = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

// The months worth asking for, as `YYYY-MM`: from the oldest month with something to show (the last
// complete month, which keeps its whole standing, or the oldest winner on record) to the running
// one. `previous` is the last complete month: the oldest whose standing is kept.
export function pickableMonths(
  winners: readonly { year: number; month: number }[],
  now: Date,
) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const previous =
    month === 1 ? monthValue(year - 1, 12) : monthValue(year, month - 1);
  const oldest = winners.map((entry) => monthValue(entry.year, entry.month));
  return {
    min: [previous, ...oldest].sort()[0],
    max: monthValue(year, month),
    previous,
  };
}

// Asks for the standing of a month: a plain form that opens `/members/month?month=YYYY-MM`, so it
// needs no script. Where the browser has no month field it is a text field that takes the same
// `YYYY-MM`. `value`, `min` and `max` are months in that form. Under it, what an older month shows.
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
  return (
    <search className={className}>
      <form action="/members/month" className="flex gap-2">
        <Label htmlFor={id} className="sr-only">
          {t("label")}
        </Label>
        <Input
          id={id}
          type="month"
          name="month"
          defaultValue={value}
          min={min}
          max={max}
          required
          pattern="[0-9]{4}-[0-9]{2}"
          placeholder={t("placeholder")}
          aria-describedby={`${id}-hint`}
          className="min-w-0 flex-1"
        />
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
