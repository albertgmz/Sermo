"use client";

import { useTranslations } from "next-intl";
import type { DemoState } from "@/app/(main)/admin/actions";
import { Button } from "@/components/ui/button";

export function FormFooter({
  state,
  pending,
}: {
  state: DemoState;
  pending: boolean;
}) {
  const t = useTranslations("admin.formFooter");
  return (
    <div className="space-y-3">
      <p
        id="form-error"
        role="alert"
        className="text-sm text-destructive empty:hidden"
      >
        {state?.error}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} className="min-h-10">
          {pending ? t("pending") : t("submit")}
        </Button>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
    </div>
  );
}
