import { getTranslations } from "next-intl/server";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FieldGroup } from "@/components/staff/edit-form";

// The last card of the group and promotion forms: the administrator's own password, which their
// actions check before changing who belongs to what (the field `actorPassword`).
export async function ConfirmField({ id }: { id: string }) {
  const t = await getTranslations("adminGroups.form");
  return (
    <FieldGroup legend={t("sectionConfirm")}>
      <ConfirmPassword id={id} />
    </FieldGroup>
  );
}
