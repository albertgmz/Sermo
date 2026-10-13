"use client";

// ConfirmStep: the confirmation step of a destructive or irreversible action, rendered in the page
// as a closed details block (no dialog, no script to reach it). Opening it shows what will happen,
// its inputs and the button that does it; the backend's refusal comes back under the button, and
// the block stays open while there is a message to read.
//
// Props
//   action        (previous, formData) => Promise<StaffFormState>; ends in a redirect on success
//                 or answers `error`, `fields` or `notice`.
//   fields        Hidden fields the action reads, by name (ids, the new state).
//   summary       Label of the block, which opens the confirmation. With `heading` and no
//                 `summary`, "<submit>…".
//   warning       Optional line of what the action does.
//   submit        Label of the button that does it. Default: `summary`.
//   pendingLabel  Label of the button while the action runs. Default: `submit`.
//   reason        Label of an optional reason field (sent as `reason`), or undefined for none.
//   danger        true (default) draws the summary and the button as destructive, false as a
//                 plain action.
//   heading       Optional. Wraps the step in a panel with this heading and a destructive border,
//                 for the one delete of a record's page.
//   password      true asks for the administrator's own password (the field `actorPassword`),
//                 whose refusal is shown on it.
//   children      The action's own inputs, shown inside the confirmation above the button.

import { useActionState, useId } from "react";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import type { StaffFormState } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { SubmitButton } from "@/components/staff/submit-button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function ConfirmStep({
  action,
  fields = {},
  summary,
  warning,
  submit,
  pendingLabel,
  reason,
  danger = true,
  heading,
  password = false,
  children,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  fields?: Record<string, string | number>;
  summary?: string;
  warning?: string;
  submit?: string;
  pendingLabel?: string;
  reason?: string;
  danger?: boolean;
  heading?: string;
  password?: boolean;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, null);
  const reasonId = useId();
  const label = submit ?? summary ?? "";
  const shown = summary ?? (heading ? `${label}…` : label);
  // In a panel the password row brings its own padding, so the other parts take theirs here.
  const panel = heading !== undefined;
  const edge = panel && password;
  const block = (
    <details
      open={Boolean(state?.error || state?.fields || state?.notice)}
      className="min-w-0"
    >
      <summary
        className={cn(
          "inline-flex min-h-10 cursor-pointer items-center text-sm font-medium",
          panel && "flex px-4",
          danger ? "text-destructive" : "text-primary",
        )}
      >
        {shown}
      </summary>
      <form
        action={formAction}
        className={cn(
          "space-y-3",
          panel
            ? cn("border-t", !password && "p-4")
            : "mt-2 rounded-md border p-3",
        )}
      >
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        {warning && (
          <p className={cn("text-sm text-pretty", edge && "px-4 pt-4")}>
            {warning}
          </p>
        )}
        {reason && (
          <div className="grid gap-1.5">
            <label htmlFor={reasonId} className="text-xs font-medium">
              {reason}
            </label>
            <Input id={reasonId} name="reason" />
          </div>
        )}
        {children}
        {password && (
          <ConfirmPassword
            id={`${reasonId}-password`}
            error={state?.fields?.actorPassword}
          />
        )}
        <output
          className={cn(
            "block text-xs font-medium [overflow-wrap:anywhere] empty:hidden",
            state?.error ? "text-destructive" : "text-success",
            edge && "px-4",
          )}
        >
          {state?.error ?? state?.notice}
        </output>
        <div className={cn(edge && "px-4 pb-4")}>
          <SubmitButton
            label={label}
            pendingLabel={pendingLabel ?? label}
            variant={danger ? "destructive" : "default"}
          />
        </div>
      </form>
    </details>
  );
  return panel ? (
    <Section heading={heading} className="border-destructive/30">
      {block}
    </Section>
  ) : (
    block
  );
}
