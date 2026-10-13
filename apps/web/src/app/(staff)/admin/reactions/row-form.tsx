"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { StaffFormState } from "@/components/staff/form-rows";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { updateReactionType } from "./actions";

// The fields of one reaction type, saved on their own.
export function ReactionRowForm({
  id,
  emoji,
  title,
  score,
}: {
  id: number;
  emoji: string;
  title: string;
  score: number;
}) {
  const t = useTranslations("adminContent.reactions.row");
  const [state, action] = useActionState<StaffFormState, FormData>(
    updateReactionType,
    null,
  );
  const field = `reaction-${id}`;
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-cols-[5rem_minmax(0,1fr)_5rem] gap-2">
        <div className="space-y-1">
          <label htmlFor={`${field}-emoji`} className="text-xs font-medium">
            {t("emoji")}
          </label>
          <Input
            id={`${field}-emoji`}
            name="emoji"
            defaultValue={emoji}
            required
            aria-invalid={Boolean(state?.fields?.emoji)}
          />
        </div>
        <div className="min-w-0 space-y-1">
          <label htmlFor={`${field}-title`} className="text-xs font-medium">
            {t("title")}
          </label>
          <Input
            id={`${field}-title`}
            name="title"
            defaultValue={title}
            required
            aria-invalid={Boolean(state?.fields?.title)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${field}-score`} className="text-xs font-medium">
            {t("score")}
          </label>
          <Input
            id={`${field}-score`}
            name="score"
            type="number"
            inputMode="numeric"
            defaultValue={score}
            required
            aria-invalid={Boolean(state?.fields?.score)}
          />
        </div>
      </div>
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
