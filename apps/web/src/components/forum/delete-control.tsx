"use client";

import { useState } from "react";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A button that asks first: it opens a small form with a confirming button (and, when
// `reasonLabel` is given, a reason field). It is the one confirm step of the forum's irreversible
// actions: deleting, removing a cover, moving, splitting.
//
// Props
//   action       The server action the confirming button submits.
//   label        The button that opens the step.
//   confirm      The confirming button.
//   cancel       Closes the step.
//   reasonLabel  Label and placeholder of the optional reason field; none when left out.
//   warning      A line saying what the action does, above the fields.
//   variant      "destructive" (default) or "outline" for an action that is not a deletion.
//   id           Id of the form once open, for controls elsewhere that submit with it.
//   children     The action's own inputs, shown in the step above the reason.
export function DeleteControl({
  action,
  label,
  confirm,
  cancel,
  reasonLabel,
  warning,
  variant = "destructive",
  id,
  children,
}: {
  action: (
    previous: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  label: string;
  confirm: string;
  cancel: string;
  reasonLabel?: string;
  warning?: string;
  variant?: "destructive" | "outline";
  id?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        type="button"
        variant={variant}
        className="h-10 px-3"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <ActionForm
      id={id}
      action={action}
      submit={confirm}
      variant={variant}
      aside={
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3"
          onClick={() => setOpen(false)}
        >
          {cancel}
        </Button>
      }
    >
      {warning && <p className="text-sm text-pretty">{warning}</p>}
      {children}
      {reasonLabel && (
        <Input
          name="reason"
          aria-label={reasonLabel}
          placeholder={reasonLabel}
          autoComplete="off"
        />
      )}
    </ActionForm>
  );
}
