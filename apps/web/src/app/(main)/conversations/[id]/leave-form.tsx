"use client";

import { useActionState } from "react";
import { leaveAction } from "@/app/(main)/conversations/actions";
import { PendingButton } from "@/components/forum/pending-button";

// Leaving can be refused; the backend's reason is shown under the header's row.
export function LeaveForm({
  conversationId,
  label,
  ariaLabel,
  children,
}: {
  conversationId: number;
  label: string;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [state, action] = useActionState(
    leaveAction.bind(null, conversationId),
    {},
  );
  return (
    <>
      <form action={action}>
        <PendingButton
          variant="ghost"
          aria-label={ariaLabel}
          className="h-10 px-2 text-xs text-muted-foreground"
        >
          {children}
          <span className="max-sm:sr-only">{label}</span>
        </PendingButton>
      </form>
      {state.error && (
        <p role="alert" className="basis-full px-2 text-xs text-destructive">
          {state.error}
        </p>
      )}
    </>
  );
}
