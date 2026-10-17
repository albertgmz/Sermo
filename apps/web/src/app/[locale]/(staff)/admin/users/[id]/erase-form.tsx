import { getTranslations } from "next-intl/server";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { Field } from "@/components/staff/edit-form";
import { FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AdminMember } from "../data";
import { eraseMember } from "./actions";

// The danger block that erases the account: what it removes and keeps, then a form that asks for
// a reason, the administrator's password and the member's username typed out.
export async function EraseForm({ member }: { member: AdminMember }) {
  const t = await getTranslations("adminUsers.erase");
  return (
    <details className="group rounded-lg border border-destructive/30 bg-card">
      <summary className="flex min-h-10 cursor-pointer items-center px-4 py-3 text-sm font-semibold text-destructive">
        {t("heading")}
      </summary>
      <div className="space-y-3 border-t p-4 text-sm text-pretty">
        <p>{t("removes")}</p>
        <p>{t("keeps")}</p>
        <p className="font-medium">{t("permanent")}</p>
      </div>
      <FormRows
        action={eraseMember}
        heading={t("formHeading")}
        submit={t("submit")}
      >
        <input type="hidden" name="id" value={member.card.id} />
        <Field
          name="reason"
          label={t("reason")}
          htmlFor="erase-reason"
          help={t("reasonHelp")}
        >
          <Textarea id="erase-reason" name="reason" rows={3} required />
        </Field>
        <ConfirmPassword id="erase-password" />
        <Field
          name="confirmUsername"
          label={t("confirm")}
          htmlFor="erase-username"
          help={t("confirmHelp", { username: member.card.username })}
        >
          <Input
            id="erase-username"
            name="confirmUsername"
            required
            autoComplete="off"
            autoCapitalize="none"
          />
        </Field>
      </FormRows>
    </details>
  );
}
