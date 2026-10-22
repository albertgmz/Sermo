"use client";

import { leaveAction } from "@/app/[locale]/(main)/conversations/actions";
import { DeleteControl } from "@/components/forum/delete-control";
import { Label } from "@/components/ui/label";

// The step the leave button opens: the choice about future messages and the confirming button. It
// is code for a press, so the conversation page asks for it only when the button is pressed.
export function LeaveStep({
  conversationId,
  label,
  open,
  onOpenChange,
  texts,
}: {
  conversationId: number;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  texts: {
    warning: string;
    legend: string;
    accept: string;
    ignore: string;
    confirm: string;
    cancel: string;
  };
}) {
  return (
    <DeleteControl
      open={open}
      onOpenChange={onOpenChange}
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
