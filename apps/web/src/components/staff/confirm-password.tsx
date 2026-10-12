"use client";

// ConfirmPassword: the row for the acting administrator's own password, for the forms whose
// action checks it before changing anything (the backend's `actorPassword`). Autocomplete is off
// so a browser does not offer a saved password for a field that is not a sign-in.
//
// Props
//   name   Name of the field the action reads. Default: "actorPassword".
//   id     Id of the control. Default: "confirm-password"; give another when two are on a page.
//   error  Optional error line. Without it, the row shows the error that the enclosing
//          `FormRows` holds for `name` (a state's `fields`).

import { useTranslations } from "next-intl";
import { PasswordField } from "@/app/(auth)/password-field";
import { useFieldError } from "./form-rows";
import { Help, Row } from "./rows";

export function ConfirmPassword({
  name = "actorPassword",
  id = "confirm-password",
  error,
}: {
  name?: string;
  id?: string;
  error?: string;
}) {
  const t = useTranslations("admin.confirmPassword");
  const fromForm = useFieldError(name);
  const shown = error ?? fromForm;
  return (
    <Row label={t("label")} htmlFor={id}>
      <PasswordField id={id} name={name} autoComplete="off" required />
      <Help id={`${id}-help`}>{t("help")}</Help>
      {shown && (
        <p
          id={`${id}-error`}
          className="text-xs font-medium text-destructive [overflow-wrap:anywhere]"
        >
          {shown}
        </p>
      )}
    </Row>
  );
}
