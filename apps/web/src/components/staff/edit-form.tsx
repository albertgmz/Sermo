"use client";

// The edit pattern of the panel: the form of a separate "Add" or "Edit" page, for a server action
// that returns a form state (`StaffFormState`, as `FormRows` takes).
//
// EditForm props
//   action    (previous, formData) => Promise<StaffFormState>: ends in a redirect, or returns the
//             state (a form-level error or notice above the groups, field errors under each field).
//   submit    Label of the save button. Default: "Save changes".
//   disabled  true disables every control and the save button.
//   children  `FieldGroup`s, then at most one `Advanced`.
// The save bar sits at the bottom of the form and sticks to the bottom of the viewport while the
// form is on screen. The fields keep what was typed when the action answers with a state.
//
// FieldGroup: a card of related fields, as a fieldset.
//   legend       The group's heading; `description` an optional line under it.
//   children     `Field`s.
//
// Field (field.tsx): one field, label and help on the left, the control on the right.
//
// Advanced: a closed card of options most edits never touch (`label` defaults to "Advanced
// options"). It opens by itself whenever a save comes back with an error on one of `fields` (the
// names of the controls inside), and when the browser stops a save on a control inside it (a
// `required` one left empty), so the browser can point at it. Its fields are sent whether it is
// open or not.

import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useContext, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { FieldErrors, SaveBar, type StaffFormState } from "./form-rows";

export { Field } from "./field";

export function EditForm({
  action,
  submit,
  disabled,
  children,
}: {
  action: (
    previous: StaffFormState,
    formData: FormData,
  ) => Promise<StaffFormState>;
  submit?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.formRows");
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      // React empties an uncontrolled form once its action settles; the fields keep what was
      // typed so a refused save can be corrected.
      onResetCapture={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      className="min-w-0 space-y-4"
    >
      <p
        role="status"
        className={cn(
          "block rounded-lg border bg-card px-4 py-2.5 text-xs font-medium [overflow-wrap:anywhere] empty:hidden",
          state?.error ? "text-destructive" : "text-success",
        )}
      >
        {state?.error ?? state?.notice}
      </p>
      <FieldErrors value={state?.fields ?? {}}>
        <fieldset disabled={disabled} className="min-w-0 space-y-4">
          {children}
        </fieldset>
      </FieldErrors>
      <SaveBar
        submit={submit ?? t("save")}
        disabled={disabled}
        className="rounded-lg border"
      />
    </form>
  );
}

export function FieldGroup({
  legend,
  description,
  children,
}: {
  legend: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-lg border bg-card">
      {/* Floated, the legend leaves the border alone and takes the card's first line. */}
      <legend className="float-left w-full border-b p-4">
        <span className="block text-sm font-semibold">{legend}</span>
        {description && (
          <span className="block text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </legend>
      <div className="clear-both divide-y">{children}</div>
    </fieldset>
  );
}

export function Advanced({
  label,
  fields = [],
  children,
}: {
  label?: React.ReactNode;
  fields?: readonly string[];
  children: React.ReactNode;
}) {
  const t = useTranslations("admin.editForm");
  const errors = useContext(FieldErrors);
  const failed = fields.some((name) => name in errors);
  const card = useRef<HTMLDetailsElement>(null);
  // Each refused save brings its own errors: open the card again even if it was closed after the
  // last one.
  const failure = failed ? errors : undefined;
  useEffect(() => {
    if (failure && card.current) card.current.open = true;
  }, [failure]);
  return (
    <details
      ref={card}
      open={failed || undefined}
      onInvalidCapture={(event) => {
        event.currentTarget.open = true;
      }}
      className="group min-w-0 rounded-lg border bg-card"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg px-4 text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        {label ?? t("advanced")}
      </summary>
      <div className="divide-y border-t">{children}</div>
    </details>
  );
}
