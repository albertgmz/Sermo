"use client";

import { useActionState } from "react";
import { PendingButton } from "@/components/forum/pending-button";

export type FormState = { error: string } | null;

// A form of label / control rows with one submit button. The action answers a message to show
// or ends in a redirect. The fields keep what was typed when the backend refuses it.
export function ActionForm({
  action,
  submit,
  extra,
  children,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  submit: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      onResetCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="divide-y">{children}</div>
      <div className="flex flex-wrap items-center gap-3 border-t p-4">
        <PendingButton className="min-h-10 px-4">{submit}</PendingButton>
        {extra}
        <output className="min-w-0 text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
          {state?.error}
        </output>
      </div>
    </form>
  );
}
