import { getTranslations } from "next-intl/server";
import { FormRows } from "@/components/staff/form-rows";
import { saveSeo } from "../actions";
import { getSettings } from "../data";
import { TextRow } from "../fields";

export async function SeoForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.seo"),
    getSettings(),
  ]);
  return (
    <FormRows action={saveSeo} heading={t("formHeading")}>
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
    </FormRows>
  );
}
