import { getTranslations } from "next-intl/server";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { Field, FieldGroup } from "@/components/staff/edit-form";

// The last card of the group and promotion forms: the administrator's own password, which their
// actions check before changing who belongs to what (the field `actorPassword`).
export async function ConfirmField({ id }: { id: string }) {
  const [t, confirm] = await Promise.all([
    getTranslations("adminGroups.form"),
    getTranslations("admin.confirmPassword"),
  ]);
  return (
    <FieldGroup legend={t("sectionConfirm")}>
      <Field
        name="actorPassword"
        label={confirm("label")}
        htmlFor={id}
        help={confirm("help")}
      >
        <PasswordField
          id={id}
          name="actorPassword"
          autoComplete="off"
          required
        />
      </Field>
    </FieldGroup>
  );
}
