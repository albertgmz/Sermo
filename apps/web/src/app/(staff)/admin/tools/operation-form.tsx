"use client";

// OperationForm: the confirmation step of a maintenance operation, rendered in the page as a
// closed details block. Opening it shows what will happen and the button that does it; the
// backend's answer (or refusal) stays under the button.
//
// Props
//   action    (previous, formData) => Promise<StaffFormState>.
//   fields    Hidden fields the action reads (which operation, which member).
//   summary   Label of the block, which opens the confirmation.
//   warning   What running it does.
//   submit    Label of the button that runs it.
//   children  The operation's own inputs, shown inside the confirmation.

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Button } from "@/components/ui/button";

function Submit({ label }: { label: string }) {
  const t = useTranslations("adminTools.maintenance");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="min-h-10 px-4">
      {pending ? t("running") : label}
    </Button>
  );
}

export function OperationForm({
  action,
  fields,
  summary,
  warning,
  submit,
  children,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields: Record<string, string>;
  summary: string;
  warning: string;
  submit: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <details open={Boolean(state)} className="group">
      <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-primary">
        {summary}
      </summary>
      <form action={formAction} className="space-y-3 border-t pt-3">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <p className="text-sm text-pretty">{warning}</p>
        {children}
        <Submit label={submit} />
        <output
          className={
            state?.error
              ? "block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden"
              : "block text-xs font-medium text-success [overflow-wrap:anywhere] empty:hidden"
          }
        >
          {state?.error ?? state?.notice}
        </output>
      </form>
    </details>
  );
}
