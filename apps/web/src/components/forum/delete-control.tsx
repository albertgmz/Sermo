"use client";

import { useState } from "react";
import {
  ActionForm,
  type ActionFormState,
} from "@/components/forum/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A delete button that asks first: it opens a small form with the reason and a confirming button.
export function DeleteControl({
  action,
  label,
  confirm,
  cancel,
  reasonLabel,
}: {
  action: (
    previous: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  label: string;
  confirm: string;
  cancel: string;
  reasonLabel: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button
        type="button"
        variant="destructive"
        className="h-10 px-3"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }
  return (
    <ActionForm
      action={action}
      submit={confirm}
      variant="destructive"
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
      <Input
        name="reason"
        maxLength={1000}
        aria-label={reasonLabel}
        placeholder={reasonLabel}
        autoComplete="off"
      />
    </ActionForm>
  );
}
