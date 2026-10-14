import { getTranslations } from "next-intl/server";
import { FormRows } from "@/components/staff/form-rows";
import { saveWarnings } from "../actions";
import { getSettings } from "../data";
import { NumberRow } from "../fields";

export async function WarningsForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.warnings"),
    getSettings(),
  ]);
  return (
    <FormRows action={saveWarnings} heading={t("formHeading")}>
      <NumberRow
        name="warningBanThreshold"
        value={settings.warningBanThreshold}
      />
      <NumberRow name="warningBanDays" value={settings.warningBanDays} />
    </FormRows>
  );
}
