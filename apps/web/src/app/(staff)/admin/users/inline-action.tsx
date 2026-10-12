"use client";

// InlineAction: a one-button action on a row (lift a ban, revoke a session, take an award back),
// with its confirmation step rendered in place as a closed details block. Opening it shows an
// optional reason field and the button; the backend's refusal comes back under the button.
//
// Props
//   action   (previous, formData) => Promise<StaffFormState>; ends in a redirect on success.
//   fields   Hidden fields the action reads, by name (ids).
//   label    Label of the block and of the button.
//   reason   Label of the reason field, or undefined for an action with no reason.
//   warning  Optional line of what the action does.
//   danger   true draws the button as destructive. Default true.
//   disabled true shows the block off (a row the viewer may read but not change).

import { useActionState, useId } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function Submit({ label, danger }: { label: string; danger: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={danger ? "destructive" : "default"}
      disabled={pending}
      className="min-h-10 px-4"
    >
      {label}
    </Button>
  );
}

export function InlineAction({
  action,
  fields,
  label,
  reason,
  warning,
  danger = true,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields: Record<string, string | number>;
  label: string;
  reason?: string;
  warning?: string;
  danger?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const reasonId = useId();
  return (
    <details open={Boolean(state?.error)} className="min-w-0">
      <summary className="inline-flex min-h-10 cursor-pointer items-center text-sm font-medium text-primary underline-offset-4 hover:underline">
        {label}
      </summary>
      <form
        action={formAction}
        className="mt-2 space-y-3 rounded-md border p-3"
      >
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {warning && <p className="text-xs text-pretty">{warning}</p>}
        {reason && (
          <div className="grid gap-1.5">
            <label htmlFor={reasonId} className="text-xs font-medium">
              {reason}
            </label>
            <Input id={reasonId} name="reason" maxLength={1000} />
          </div>
        )}
        <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
          {state?.error}
        </output>
        <Submit label={label} danger={danger} />
      </form>
    </details>
  );
}
