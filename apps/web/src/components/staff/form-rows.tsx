"use client";

// FormRows: a form in a panel with a heading, for a server action that returns a form state: the
// in-page forms of the panel (a grant, a decision, an erasure). A separate "Add" or "Edit" page uses
// `EditForm` (edit-form.tsx) instead; both hold the same `Field`s.
//
// FormRows props
//   action       (previous, formData) => Promise<StaffFormState>. An action either ends in a
//                redirect (the usual outcome of a save) or returns the state below.
//   heading      The panel's heading.
//   description  Optional line under the heading.
//   submit       Label of the save button. Default: "Save changes".
//   id           Optional anchor of the panel.
//   disabled     true disables every control and the save button (a form the viewer may read but
//                not change). The backend still decides.
//   children     The rows: `Field`s (edit-form.tsx), or any row of the same padding.
//
// useFieldError(name) gives the error line of the control with that name in the enclosing form.
//
// StaffFormState
//   error        A form-level failure, shown above the rows (and read out).
//   notice       A form-level confirmation, shown the same way.
//   fields       Error lines by control name, shown under the field whose `name` matches.
//
// The save bar sticks to the bottom of the viewport while the form is on screen and is disabled,
// with its label changed, while the action runs. The fields keep what was typed when the action
// answers with a state.

import { useTranslations } from "next-intl";
import { createContext, useActionState, useContext } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Section } from "./rows";

export type StaffFormState = {
  error?: string;
  notice?: string;
  fields?: Record<string, string>;
} | null;

export const FieldErrors = createContext<Record<string, string>>({});

// The error line of a control of the form it is in, by the control's name (what `Field` shows).
export function useFieldError(name: string): string | undefined {
  return useContext(FieldErrors)[name];
}

// The save bar of a form: also the one of `EditForm` (edit-form.tsx), which frames it itself.
export function SaveBar({
  submit,
  disabled,
  className,
}: {
  submit: string;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("admin.formRows");
  const { pending } = useFormStatus();
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t bg-card/95 p-4 backdrop-blur-sm",
        className,
      )}
    >
      <Button
        type="submit"
        disabled={pending || disabled}
        aria-live="polite"
        className="min-h-10 px-4"
      >
        {pending ? t("saving") : submit}
      </Button>
    </div>
  );
}

export function FormRows({
  action,
  heading,
  description,
  submit,
  id,
  disabled,
  children,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  heading: React.ReactNode;
  description?: React.ReactNode;
  submit?: string;
  id?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.formRows");
  const [state, formAction] = useActionState(action, null);
  return (
    <Section id={id} heading={heading} description={description}>
      <form
        action={formAction}
        // React empties an uncontrolled form once its action settles; the fields keep what was
        // typed so a refused save can be corrected.
        onResetCapture={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        <p
          role="status"
          className={cn(
            "block border-b px-4 py-2.5 text-xs font-medium [overflow-wrap:anywhere] empty:hidden",
            state?.error ? "text-destructive" : "text-success",
          )}
        >
          {state?.error ?? state?.notice}
        </p>
        <FieldErrors value={state?.fields ?? {}}>
          <fieldset disabled={disabled} className="min-w-0 divide-y">
            {children}
          </fieldset>
        </FieldErrors>
        <SaveBar submit={submit ?? t("save")} disabled={disabled} />
      </form>
    </Section>
  );
}
