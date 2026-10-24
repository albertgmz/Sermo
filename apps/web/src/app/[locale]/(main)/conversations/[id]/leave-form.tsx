"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";

// The step itself (radios, confirming button, the action) comes with the first press.
const LeaveStep = dynamic(() =>
  import("@/app/[locale]/(main)/conversations/[id]/leave-step").then(
    (module) => module.LeaveStep,
  ),
);

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
  // Once pressed, the step stays mounted (closed it draws nothing) so its code is asked for once.
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        aria-label={ariaLabel}
        aria-expanded={open}
        className="h-10 px-2 text-xs text-muted-foreground"
        onClick={() => {
          setOpened(true);
          setOpen(!open);
        }}
      >
        {children}
        <span>{label}</span>
      </Button>
      {opened && (
        <LeaveStep
          conversationId={conversationId}
          label={label}
          open={open}
          onOpenChange={setOpen}
          texts={texts}
        />
      )}
    </>
  );
}
