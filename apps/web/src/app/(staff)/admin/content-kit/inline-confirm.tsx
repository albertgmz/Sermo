"use client";

// InlineConfirm: the confirmation step of an action on one row of a list, rendered in the row as a
// closed details block. Opening it shows what will happen and the button that does it; the
// backend's refusal comes back under the button.
//
// Props
//   action    (previous, formData) => Promise<StaffFormState>; ends in a redirect on success.
//   fields    Hidden fields sent with the form (the record's id, the new state).
//   summary   Label of the block, which opens the confirmation.
//   warning   What the action does.
//   submit    Label of the button that does it.
//   caution   false styles the block and the button as a plain action (default: as a danger).

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Submit({ label, caution }: { label: string; caution: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={caution ? "destructive" : "outline"}
      disabled={pending}
      className="min-h-10 px-4"
    >
      {label}
    </Button>
  );
}

export function InlineConfirm({
  action,
  fields,
  summary,
  warning,
  submit,
  caution = true,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields: Record<string, string>;
  summary: string;
  warning: string;
  submit: string;
  caution?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <details open={Boolean(state?.error)} className="min-w-0">
      <summary
        className={cn(
          "flex min-h-10 cursor-pointer items-center text-sm font-medium",
          caution ? "text-destructive" : "text-primary",
        )}
      >
        {summary}
      </summary>
      <form action={formAction} className="space-y-3 pb-2">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <p className="text-sm text-pretty">{warning}</p>
        <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
          {state?.error}
        </output>
        <Submit label={submit} caution={caution} />
      </form>
    </details>
  );
}
