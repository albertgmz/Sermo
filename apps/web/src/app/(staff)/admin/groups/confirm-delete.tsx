"use client";

// ConfirmDelete: the confirmation step of a delete, rendered in the page as a closed details
// block. Opening it shows what will happen and the button that does it; the backend's refusal
// comes back under the button.
//
// Props
//   action    (previous, formData) => Promise<StaffFormState>; ends in a redirect on success.
//   id        The record's id, sent as the hidden field `id`.
//   summary   Label of the block, which opens the confirmation.
//   warning   What deleting does.
//   submit    Label of the button that deletes.
//   password  true asks for the administrator's own password (the field `actorPassword`), whose
//             refusal is shown on it.

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="destructive"
      disabled={pending}
      className="min-h-10 px-4"
    >
      {label}
    </Button>
  );
}

export function ConfirmDelete({
  action,
  id,
  summary,
  warning,
  submit,
  password = false,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  id: number;
  summary: string;
  warning: string;
  submit: string;
  password?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <Section heading={summary} className="border-destructive/30">
      <details open={Boolean(state?.error || state?.fields)} className="group">
        <summary className="flex min-h-10 cursor-pointer items-center px-4 text-sm font-medium text-destructive">
          {submit}…
        </summary>
        <form
          action={formAction}
          className={cn("space-y-3 border-t", !password && "p-4")}
        >
          <input type="hidden" name="id" value={id} />
          <p className={cn("text-sm text-pretty", password && "px-4 pt-4")}>
            {warning}
          </p>
          {password && (
            <ConfirmPassword
              id="delete-password"
              error={state?.fields?.actorPassword}
            />
          )}
          <output
            className={cn(
              "block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden",
              password && "px-4",
            )}
          >
            {state?.error}
          </output>
          <div className={cn(password && "px-4 pb-4")}>
            <Submit label={submit} />
          </div>
        </form>
      </details>
    </Section>
  );
}
