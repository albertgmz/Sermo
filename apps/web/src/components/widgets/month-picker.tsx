import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// A month as the value of a month field: `YYYY-MM`.
export const monthValue = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}`;

// Asks for the standing of a month: a plain form that opens `/members/month?month=YYYY-MM`, so it
// needs no script. Where the browser has no month field it is a text field that takes the same
// `YYYY-MM`. `value` and `max` are months in that form.
export function MonthPicker({
  id,
  value,
  max,
  className,
}: {
  id: string;
  value?: string;
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
          max={max}
          required
          pattern="[0-9]{4}-[0-9]{2}"
          placeholder={t("placeholder")}
          className="min-w-0 flex-1"
        />
        <Button type="submit" className="h-10 md:h-8">
          {t("submit")}
        </Button>
      </form>
    </search>
  );
}
