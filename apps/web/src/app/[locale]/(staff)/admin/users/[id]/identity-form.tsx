import { getTranslations } from "next-intl/server";
import { PasswordField } from "@/app/[locale]/(auth)/password-field";
import { RelativeTime } from "@/components/forum/relative-time";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import type { AdminMember } from "../data";
import { saveIdentity } from "./actions";

const MODES = ["keep", "reset", "set"] as const;

// The identity of a member: username, email, password. Saved with the administrator's own
// password, asked first.
export async function IdentityForm({
  member,
  readOnly,
}: {
  member: AdminMember;
  readOnly: boolean;
}) {
  const t = await getTranslations("adminUsers.identity");
  const { usernameChangedAt } = member;
  const changed = usernameChangedAt
    ? t.rich("changedOn", {
        time: () => <RelativeTime date={usernameChangedAt} />,
      })
    : t("neverChanged");
  return (
    <EditForm
      key={`${member.card.username}:${member.email}:${member.emailVerified}`}
      action={saveIdentity}
      disabled={readOnly}
    >
      <input type="hidden" name="id" value={member.card.id} />
      <input type="hidden" name="usernameWas" value={member.card.username} />
      <input type="hidden" name="emailWas" value={member.email ?? ""} />
      <input
        type="hidden"
        name="verifiedWas"
        value={member.emailVerified ? "1" : "0"}
      />
      <FieldGroup legend={t("heading")} description={t("description")}>
        <ConfirmPassword />
        <Field
          name="username"
          label={t("username")}
          htmlFor="member-username"
          help={changed}
        >
          <Input
            id="member-username"
            name="username"
            required
            defaultValue={member.card.username}
          />
        </Field>
        <Field name="email" label={t("email")} htmlFor="member-email">
          <Input
            id="member-email"
            name="email"
            type="email"
            required
            defaultValue={member.email ?? ""}
          />
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="emailVerified"
              defaultChecked={member.emailVerified}
              className="size-5"
            />
            {t("verified")}
          </label>
        </Field>
        <Field name="passwordMode" label={t("password")}>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t("password")}</legend>
            {MODES.map((mode) => (
              <label
                key={mode}
                className="flex min-h-10 items-center gap-3 text-sm"
              >
                <input
                  type="radio"
                  name="passwordMode"
                  value={mode}
                  defaultChecked={mode === "keep"}
                  className="size-5"
                />
                {t(`mode.${mode}`)}
              </label>
            ))}
          </fieldset>
        </Field>
        <Field
          name="password"
          label={t("newPassword")}
          htmlFor="member-new-password"
          help={t("newPasswordHelp")}
        >
          <PasswordField
            id="member-new-password"
            name="password"
            autoComplete="new-password"
          />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
