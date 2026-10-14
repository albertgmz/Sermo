"use client";

import { useTranslations } from "next-intl";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// The reason form of a report, the same wherever something can be reported: posts, messages, wall
// posts and comments. The bar that opens it hears of the cancel button.
export function ReportForm({
  action,
  onCancel,
}: {
  action: (
    previous: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  onCancel: () => void;
}) {
  const t = useTranslations("forum.contentActions");
  return (
    <ActionForm
      action={action}
      submit={t("reportSubmit")}
      done={t("reported")}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={onCancel}
        >
          {t("cancel")}
        </Button>
      }
    >
      <Input
        name="reason"
        required
        aria-label={t("reportReason")}
        placeholder={t("reportReason")}
        autoComplete="off"
      />
    </ActionForm>
  );
}
