"use client";

// ConfirmPassword: the field for the acting administrator's own password, for the forms whose
// action checks it before changing anything (the backend's `actorPassword`), in the layout of the
// edit form's fields (`Field`). Autocomplete is off so a browser does not offer a saved password
// for a field that is not a sign-in.
//
// Props
//   name   Name of the field the action reads. Default: "actorPassword".
//   id     Id of the control. Default: "confirm-password"; give another when two are on a page.
//   error  Optional error line. Without it, the field shows the error that the enclosing
//          `EditForm` or `FormRows` holds for `name` (a state's `fields`).

import { useTranslations } from "next-intl";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { Field } from "./edit-form";

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
  return (
    <Field
      name={name}
      label={t("label")}
      htmlFor={id}
      help={t("help")}
      error={error}
    >
      <PasswordField id={id} name={name} autoComplete="off" required />
    </Field>
  );
}
