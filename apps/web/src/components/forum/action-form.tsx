"use client";

import { useActionState } from "react";
import { PendingButton } from "@/components/forum/pending-button";
import { cn } from "@/lib/utils";

export type ActionFormState = { error?: string; done?: boolean };

// A small form around one server action: the fields it is given, the button, and what the backend
// answered when it refused. A success ends in a redirect, so only a refusal (or a plain "done",
// for an action that stays on the page) is drawn here.
export function ActionForm({
  action,
  submit,
  done,
  id,
  aside,
  variant = "outline",
  className,
  children,
}: {
  action: (
    previous: ActionFormState,
    formData: FormData,
  ) => Promise<ActionFormState>;
  submit: React.ReactNode;
  // What to say once the action reports it is done.
  done?: string;
  id?: string;
  // Drawn after the button.
  aside?: React.ReactNode;
  variant?: React.ComponentProps<typeof PendingButton>["variant"];
  className?: string;
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form id={id} action={formAction} className={cn("space-y-2", className)}>
      {children}
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.done && done && (
        <p role="status" className="text-sm text-muted-foreground">
          {done}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PendingButton variant={variant} className="h-10 px-3">
          {submit}
        </PendingButton>
        {aside}
      </div>
    </form>
  );
}
