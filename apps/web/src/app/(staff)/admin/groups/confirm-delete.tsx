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

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { Button } from "@/components/ui/button";

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
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  id: number;
  summary: string;
  warning: string;
  submit: string;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <Section heading={summary} className="border-destructive/30">
      <details open={Boolean(state?.error)} className="group">
        <summary className="flex min-h-10 cursor-pointer items-center px-4 text-sm font-medium text-destructive">
          {submit}…
        </summary>
        <form action={formAction} className="space-y-3 border-t p-4">
          <input type="hidden" name="id" value={id} />
          <p className="text-sm text-pretty">{warning}</p>
          <output className="block text-xs font-medium text-destructive [overflow-wrap:anywhere] empty:hidden">
            {state?.error}
          </output>
          <Submit label={submit} />
        </form>
      </details>
    </Section>
  );
}
