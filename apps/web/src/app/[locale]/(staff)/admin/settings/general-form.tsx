import { SUPPORTED_LANGUAGES } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { saveGeneral } from "./actions";
import { getSettings } from "./data";
import { SwitchRow, TextRow } from "./fields";
import { Shown } from "./shown";

export async function GeneralForm() {
  const [t, f, settings] = await Promise.all([
    getTranslations("adminSetup.pages.general"),
    getTranslations("adminSetup.fields"),
    getSettings(),
  ]);
  const languages = await getTranslations("adminSetup.languages");
  // The networks are the ones the backend returned; one without a phrase is labelled by its key.
  const networks = Object.keys(
    settings.socialLinks,
  ) as (keyof typeof settings.socialLinks)[];
  const named = (network: string, part: "label" | "help") => {
    const key = `socialLinks.${network}.${part}` as "socialLinks.x.label";
    return f.has(key)
      ? f(key)
      : part === "label"
        ? network
        : f("socialLinks.x.help");
  };
  return (
    <FormRows action={saveGeneral} heading={t("formHeading")}>
      <TextRow name="siteName" value={settings.siteName} />
      <TextRow name="siteDescription" value={settings.siteDescription} />
      <FieldRow
        name="defaultLanguage"
        label={f("defaultLanguage.label")}
        htmlFor="field-defaultLanguage"
        help={f("defaultLanguage.help")}
      >
        <Shown name="defaultLanguage" />
        <select
          id="field-defaultLanguage"
          name="defaultLanguage"
          defaultValue={settings.defaultLanguage}
          aria-describedby="field-defaultLanguage-help"
          className={selectClass}
        >
          {SUPPORTED_LANGUAGES.map((code) => (
            <option key={code} value={code}>
              {languages(code)}
            </option>
          ))}
        </select>
      </FieldRow>
      <SwitchRow
        name="profilePostsEnabled"
        value={settings.profilePostsEnabled}
      />
      <SwitchRow name="forumStatsEnabled" value={settings.forumStatsEnabled} />
      {networks.map((network) => (
        <FieldRow
          key={network}
          name={`socialLinks.${network}`}
          label={named(network, "label")}
          htmlFor={`field-socialLinks-${network}`}
          help={named(network, "help")}
        >
          <Input
            id={`field-socialLinks-${network}`}
            name={`socialLinks.${network}`}
            type="text"
            inputMode="url"
            autoCapitalize="none"
            defaultValue={settings.socialLinks[network] ?? ""}
            aria-describedby={`field-socialLinks-${network}-help`}
          />
        </FieldRow>
      ))}
    </FormRows>
  );
}
