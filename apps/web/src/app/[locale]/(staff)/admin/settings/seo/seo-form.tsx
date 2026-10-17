import { getTranslations } from "next-intl/server";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { saveSeo } from "../actions";
import { getSettings } from "../data";
import { TextRow } from "../fields";

export async function SeoForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.seo"),
    getSettings(),
  ]);
  return (
    <EditForm action={saveSeo}>
      <FieldGroup legend={t("formHeading")}>
        <TextRow
          name="threadTitleTemplate"
          value={settings.threadTitleTemplate}
        />
        <TextRow name="nodeTitleTemplate" value={settings.nodeTitleTemplate} />
        <TextRow
          name="profileTitleTemplate"
          value={settings.profileTitleTemplate}
        />
        <TextRow
          name="indexNowKey"
          value={settings.indexNowKey}
          autoCapitalize="none"
        />
      </FieldGroup>
    </EditForm>
  );
}
