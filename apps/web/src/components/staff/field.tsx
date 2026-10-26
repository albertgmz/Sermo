"use client";

// Field: one field. Label and help on the left, the control and its error on the right from
// 768 px; stacked on a phone.
//   name     The control's name: the key of its error line.
//   label    The label; `htmlFor` ties it to the control's id (leave it out for a group of
//            controls, such as a checkbox with its own text).
//   help     Optional help, with the id `<htmlFor>-help`; the error line has `<htmlFor>-error`.
//            The control names them in its aria-describedby.
//   error    Optional error line, for a field outside an `EditForm` or `FormRows` (whose field
//            errors it shows by `name` otherwise).
//   children The control.
// The row carries `data-field` (its name), which a search result names to reveal it (./reveal;
// the mark is drawn by globals.css).
// The field of `EditForm` and `FormRows` (and of `ConfirmPassword`), kept in a module of its own
// so a page that needs only a field does not bring the edit form's text.

import { useFieldError } from "./form-rows";
import { Help } from "./rows";

export function Field({
  name,
  label,
  htmlFor,
  help,
  error,
  children,
}: {
  name: string;
  label: React.ReactNode;
  htmlFor?: string;
  help?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
}) {
  const fromForm = useFieldError(name);
  const shown = error ?? fromForm;
  return (
    <div
      data-field={name}
      className="grid gap-2 p-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6"
    >
      <div className="min-w-0 space-y-1">
        {htmlFor ? (
          <label
            id={`${htmlFor}-label`}
            htmlFor={htmlFor}
            className="block text-sm font-medium md:pt-1.5"
          >
            {label}
          </label>
        ) : (
          <p className="text-sm font-medium md:pt-1.5">{label}</p>
        )}
        {help && <Help id={htmlFor && `${htmlFor}-help`}>{help}</Help>}
      </div>
      <div className="min-w-0 space-y-2">
        {children}
        {shown && (
          <p
            id={htmlFor && `${htmlFor}-error`}
            className="text-xs font-medium text-destructive [overflow-wrap:anywhere]"
          >
            {shown}
          </p>
        )}
      </div>
    </div>
  );
}
