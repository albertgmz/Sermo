"use client";

// InlineForm: a small form inside a row or a block of a list (a tab, a prefix, a moderator),
// for a server action that returns a form state. The refusal of the backend, and the line of
// every field it names, are shown under the controls; the fields keep what was typed.
//
// Props
//   action    (previous, formData) => Promise<StaffFormState>; ends in a redirect on success.
//   submit    Label of the button.
//   variant   Button variant. Default "outline"; a delete uses "destructive".
//   className Layout of the controls and the button (the form is a flex row that wraps).
//   children  The controls (and hidden fields).

import { useActionState } from "react";
import type { StaffFormState } from "@/components/staff/form-rows";
import { SubmitButton } from "@/components/staff/submit-button";
import { cn } from "@/lib/utils";

export function InlineForm({
  action,
  submit,
  variant = "outline",
  className,
  children,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  submit: string;
  variant?: "outline" | "destructive" | "default";
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const lines = [state?.error, ...Object.values(state?.fields ?? {})].filter(
    Boolean,
  );
  return (
    <form
      action={formAction}
      onResetCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="space-y-2"
    >
      <div className={cn("flex flex-wrap items-end gap-2", className)}>
        {children}
        <SubmitButton label={submit} variant={variant} />
      </div>
      <output className="block space-y-0.5 text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </output>
    </form>
  );
}
