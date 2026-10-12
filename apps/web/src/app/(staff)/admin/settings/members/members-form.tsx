import { getTranslations } from "next-intl/server";
import { FormRows } from "@/components/staff/form-rows";
import { saveMembers } from "../actions";
import { getSettings } from "../data";
import { NumberRow, SwitchRow } from "../fields";

export async function MembersForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.members"),
    getSettings(),
  ]);
  return (
    <FormRows action={saveMembers} heading={t("formHeading")}>
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
    </FormRows>
  );
}
