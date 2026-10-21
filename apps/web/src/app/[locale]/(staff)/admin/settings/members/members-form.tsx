import { REGISTRATION_FIELDS } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { saveMembers } from "../actions";
import { getSettings } from "../data";
import { ChecklistRow, NumberRow, SwitchRow } from "../fields";

export async function MembersForm() {
  const [t, fieldNames, settings] = await Promise.all([
    getTranslations("adminSetup.pages.members"),
    getTranslations("adminSetup.registrationFields"),
    getSettings(),
  ]);
  return (
    <EditForm action={saveMembers}>
      <FieldGroup
        legend={t("registration")}
        description={t("registrationNote")}
      >
        <SwitchRow name="registrationOpen" value={settings.registrationOpen} />
        <SwitchRow name="approveSignups" value={settings.approveSignups} />
        <SwitchRow
          name="requireEmailConfirmation"
          value={settings.requireEmailConfirmation}
        />
        <NumberRow name="minimumAge" value={settings.minimumAge} />
        <ChecklistRow
          name="registrationFields"
          options={REGISTRATION_FIELDS.map((kind) => ({
            kind,
            label: fieldNames(kind),
          }))}
          value={settings.registrationFields}
        />
      </FieldGroup>
      <FieldGroup legend={t("formHeading")}>
        <NumberRow name="newMemberDays" value={settings.newMemberDays} />
        <NumberRow
          name="firstPostsToModerate"
          value={settings.firstPostsToModerate}
        />
        <SwitchRow
          name="moderateLinksFromNewMembers"
          value={settings.moderateLinksFromNewMembers}
        />
        <NumberRow
          name="newMemberMentionLimit"
          value={settings.newMemberMentionLimit}
        />
      </FieldGroup>
    </EditForm>
  );
}
