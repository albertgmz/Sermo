"use client";

import { FormError } from "@/components/forum/form-error";
import { PendingButton } from "@/components/forum/pending-button";
import { useKeptForm } from "@/components/forum/use-kept-form";
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
  submitDisabled,
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
  // The button waits for something to submit; it keeps the focus if it has it.
  submitDisabled?: boolean;
  variant?: React.ComponentProps<typeof PendingButton>["variant"];
  className?: string;
  children?: React.ReactNode;
}) {
  const { state, onSubmit } = useKeptForm(action);
  return (
    <form id={id} onSubmit={onSubmit} className={cn("space-y-2", className)}>
      {children}
      {state.error && <FormError>{state.error}</FormError>}
      {state.done && done && (
        <p role="status" className="text-sm text-muted-foreground">
          {done}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <PendingButton
          variant={variant}
          className="h-10 px-3 aria-disabled:opacity-50"
          disabled={submitDisabled}
          focusableWhenDisabled
        >
          {submit}
        </PendingButton>
        {aside}
      </div>
    </form>
  );
}
