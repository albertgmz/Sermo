import { getTranslations } from "next-intl/server";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { Field } from "@/components/staff/edit-form";

// The administrator's own password, in the layout of the edit form's fields (`ConfirmPassword`
// is drawn in the older row layout): the field a member's group and identity changes ask for. Its
// refusal shows under it, from the form's field errors.
export async function AdminPassword({
  id = "confirm-password",
}: {
  id?: string;
}) {
  const t = await getTranslations("admin.confirmPassword");
  return (
    <Field
      name="actorPassword"
      label={t("label")}
      htmlFor={id}
      help={t("help")}
    >
      <PasswordField id={id} name="actorPassword" autoComplete="off" required />
    </Field>
  );
}
