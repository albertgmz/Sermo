"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { StaffFormState } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { saveWordFilter } from "./actions";

// The fields of one word filter, saved on their own. The term identifies the filter.
export function WordFilterRowForm({
  id,
  term,
  action,
  replacement,
  isActive,
}: {
  id: number;
  term: string;
  action: "replace" | "moderate";
  replacement: string | null;
  isActive: boolean;
}) {
  const t = useTranslations("adminContent.wordFilters.row");
  const [state, formAction] = useActionState<StaffFormState, FormData>(
    saveWordFilter,
    null,
  );
  const field = `filter-${id}`;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="term" value={term} />
      <div className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <div className="space-y-1">
          <label htmlFor={`${field}-action`} className="text-xs font-medium">
            {t("action")}
          </label>
          <select
            id={`${field}-action`}
            name="action"
            defaultValue={action}
            className={selectClass}
          >
            <option value="replace">{t("replace")}</option>
            <option value="moderate">{t("moderate")}</option>
          </select>
        </div>
        <div className="min-w-0 space-y-1">
          <label
            htmlFor={`${field}-replacement`}
            className="text-xs font-medium"
          >
            {t("replacement")}
          </label>
          <Input
            id={`${field}-replacement`}
            name="replacement"
            defaultValue={replacement ?? ""}
          />
        </div>
      </div>
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="isActive"
          defaultChecked={isActive}
          className="size-5"
        />
        {t("active")}
      </label>
      <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
        {[state?.error, ...Object.values(state?.fields ?? {})]
          .filter(Boolean)
          .join(" ")}
      </output>
      <SubmitButton
        label={t("save")}
        pendingLabel={t("saving")}
        variant="outline"
      />
    </form>
  );
}
