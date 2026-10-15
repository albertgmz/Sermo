import { getTranslations } from "next-intl/server";
import { FormRows } from "@/components/staff/form-rows";
import { RuleField } from "@/components/staff/rule-field";
import { saveAntispam } from "../actions";
import { getSettings } from "../data";
import { NumberRow } from "../fields";
import { Shown } from "../shown";

export async function AntispamForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.antispam"),
    getSettings(),
  ]);
  return (
    <FormRows action={saveAntispam} heading={t("formHeading")}>
      <NumberRow name="floodSeconds" value={settings.floodSeconds} />
      <Shown name="linksRule" />
      <RuleField place="postLinks" name="linksRule" rule={settings.linksRule} />
      <Shown name="approvalRule" />
      <RuleField
        place="postApproval"
        name="approvalRule"
        rule={settings.approvalRule}
      />
    </FormRows>
  );
}
