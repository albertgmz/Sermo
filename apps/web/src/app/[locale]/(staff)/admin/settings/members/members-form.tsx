import { getTranslations } from "next-intl/server";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { saveMembers } from "../actions";
import { getSettings } from "../data";
import { NumberRow, SwitchRow } from "../fields";

export async function MembersForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.members"),
    getSettings(),
  ]);
  return (
    <EditForm action={saveMembers}>
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
        <SwitchRow name="approveSignups" value={settings.approveSignups} />
        <NumberRow
          name="newMemberMentionLimit"
          value={settings.newMemberMentionLimit}
        />
      </FieldGroup>
    </EditForm>
  );
}
