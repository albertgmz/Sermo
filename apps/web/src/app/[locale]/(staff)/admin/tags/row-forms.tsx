"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import type { StaffFormState } from "@/components/staff/form-rows";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { mergeTag, renameTag } from "./actions";

type Action = (
  previous: StaffFormState,
  formData: FormData,
) => Promise<StaffFormState>;

// One field and its button, saved on their own: the rename of a tag and its merge into another
// are the same shape.
function TagForm({
  id,
  field,
  value,
  action,
  label,
  submit,
}: {
  id: number;
  field: "name" | "into";
  value: string;
  action: Action;
  label: string;
  submit: string;
}) {
  const t = useTranslations("adminContent.tags.row");
  const [state, formAction] = useActionState<StaffFormState, FormData>(
    action,
    null,
  );
  const inputId = `tag-${id}-${field}`;
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="id" value={id} />
      <label htmlFor={inputId} className="text-xs font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          name={field}
          defaultValue={value}
          autoComplete="off"
          autoCapitalize="none"
          className="min-w-0"
        />
        <SubmitButton
          label={submit}
          pendingLabel={t("saving")}
          variant="outline"
        />
      </div>
      <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
        {[state?.error, ...Object.values(state?.fields ?? {})]
          .filter(Boolean)
          .join(" ")}
      </output>
    </form>
  );
}

// What can be done to a tag besides deleting it: give it another name, or fold it into another tag.
export function TagRowForms({ id, name }: { id: number; name: string }) {
  const t = useTranslations("adminContent.tags.row");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <TagForm
        id={id}
        field="name"
        value={name}
        action={renameTag}
        label={t("rename")}
        submit={t("renameSubmit")}
      />
      <TagForm
        id={id}
        field="into"
        value=""
        action={mergeTag}
        label={t("merge")}
        submit={t("mergeSubmit")}
      />
    </div>
  );
}
