"use client";

import { useState } from "react";
import { leaveAction } from "@/app/[locale]/(main)/conversations/actions";
import { DeleteControl } from "@/components/forum/delete-control";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Leaving asks first, as XenForo does: the button opens a step under the header's row with the
// choice about future messages (accept them, which is the default and brings the conversation back
// on a new reply, or ignore them) and the confirming button. Leaving can be refused; the backend's
// reason is shown in the step.
export function LeaveForm({
  conversationId,
  label,
  ariaLabel,
  texts,
  children,
}: {
  conversationId: number;
  label: string;
  ariaLabel: string;
  texts: {
    warning: string;
    legend: string;
    accept: string;
    ignore: string;
    confirm: string;
    cancel: string;
  };
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label={ariaLabel}
        aria-expanded={open}
        className="h-10 px-2 text-xs text-muted-foreground"
        onClick={() => setOpen(!open)}
      >
        {children}
        <span className="max-sm:sr-only">{label}</span>
      </Button>
      <DeleteControl
        open={open}
        onOpenChange={setOpen}
        action={leaveAction.bind(null, conversationId)}
        label={label}
        confirm={texts.confirm}
        cancel={texts.cancel}
        warning={texts.warning}
        variant="outline"
        className="basis-full px-2"
      >
        <FutureMessagesChoice
          legend={texts.legend}
          accept={texts.accept}
          ignore={texts.ignore}
        />
      </DeleteControl>
    </>
  );
}

// The choice about future messages: "accept" (checked, the default) or "ignore".
export function FutureMessagesChoice({
  legend,
  accept,
  ignore,
}: {
  legend: string;
  accept: string;
  ignore: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium">{legend}</legend>
      <Label className="min-h-10 text-sm font-normal">
        <input
          type="radio"
          name="futureMessages"
          value="accept"
          defaultChecked
          className="size-4 accent-primary"
        />
        {accept}
      </Label>
      <Label className="min-h-10 text-sm font-normal">
        <input
          type="radio"
          name="futureMessages"
          value="ignore"
          className="size-4 accent-primary"
        />
        {ignore}
      </Label>
    </fieldset>
  );
}
