import { CircleCheck } from "lucide-react";
import { useTranslations } from "next-intl";

export function DemoNotice() {
  const t = useTranslations("admin.demoNotice");
  return (
    <output className="flex items-start gap-3 rounded-lg border bg-card p-4">
      <CircleCheck
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-success"
      />
      <span className="min-w-0 text-sm">
        <span className="block font-semibold">{t("heading")}</span>
        <span className="mt-1 block text-muted-foreground">
          {t("description")}
        </span>
      </span>
    </output>
  );
}
