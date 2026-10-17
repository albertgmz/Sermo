import { getTranslations } from "next-intl/server";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { saveSuperAdmin } from "./actions";

// The super admin status of a member, for a viewer who may change it. Saved with the
// administrator's own password, asked first.
export async function SuperAdminForm({
  userId,
  superAdmin,
}: {
  userId: number;
  superAdmin: boolean;
}) {
  const t = await getTranslations("adminUsers.groups");
  return (
    <EditForm key={String(superAdmin)} action={saveSuperAdmin}>
      <input type="hidden" name="id" value={userId} />
      <FieldGroup
        legend={t("superAdminHeading")}
        description={t("superAdminDescription")}
      >
        <ConfirmPassword id="confirm-password-super-admin" />
        <Field
          name="superAdmin"
          label={t("superAdminLabel")}
          htmlFor="member-super-admin"
          help={t("superAdminHelp")}
        >
          <input
            id="member-super-admin"
            type="checkbox"
            name="superAdmin"
            defaultChecked={superAdmin}
            className="size-5"
          />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
