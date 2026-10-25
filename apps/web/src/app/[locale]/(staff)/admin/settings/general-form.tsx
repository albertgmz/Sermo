import { SUPPORTED_LANGUAGES } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { languageName } from "@/lib/language-name";
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
    <EditForm action={saveGeneral}>
      <FieldGroup legend={t("formHeading")}>
        <TextRow name="siteName" value={settings.siteName} />
        <TextRow name="siteDescription" value={settings.siteDescription} />
        <Field
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
                {languageName(code)}
              </option>
            ))}
          </select>
        </Field>
        <SwitchRow
          name="profilePostsEnabled"
          value={settings.profilePostsEnabled}
        />
        <SwitchRow name="adultMode" value={settings.adultMode} />
      </FieldGroup>
      {networks.length > 0 && (
        <FieldGroup
          legend={t("linksHeading")}
          description={t("linksDescription")}
        >
          {networks.map((network) => (
            <Field
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
            </Field>
          ))}
        </FieldGroup>
      )}
      <FieldGroup
        legend={t("analyticsHeading")}
        description={t("analyticsDescription")}
      >
        <Shown name="analytics" />
        <Field
          name="analytics.provider"
          label={f("analytics.provider.label")}
          htmlFor="field-analytics-provider"
          help={f("analytics.provider.help")}
        >
          <select
            id="field-analytics-provider"
            name="analytics.provider"
            defaultValue={settings.analytics.provider}
            aria-describedby="field-analytics-provider-help"
            className={selectClass}
          >
            {(["none", "matomo", "google"] as const).map((provider) => (
              <option key={provider} value={provider}>
                {f(`analytics.options.${provider}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field
          name="analytics.url"
          label={f("analytics.url.label")}
          htmlFor="field-analytics-url"
          help={f("analytics.url.help")}
        >
          <Input
            id="field-analytics-url"
            name="analytics.url"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            defaultValue={
              settings.analytics.provider === "matomo"
                ? settings.analytics.url
                : ""
            }
            aria-describedby="field-analytics-url-help"
          />
        </Field>
        <Field
          name="analytics.siteId"
          label={f("analytics.siteId.label")}
          htmlFor="field-analytics-siteId"
          help={f("analytics.siteId.help")}
        >
          <Input
            id="field-analytics-siteId"
            name="analytics.siteId"
            type="number"
            inputMode="numeric"
            defaultValue={
              settings.analytics.provider === "matomo"
                ? settings.analytics.siteId
                : ""
            }
            aria-describedby="field-analytics-siteId-help"
          />
        </Field>
        <Field
          name="analytics.measurementId"
          label={f("analytics.measurementId.label")}
          htmlFor="field-analytics-measurementId"
          help={f("analytics.measurementId.help")}
        >
          <Input
            id="field-analytics-measurementId"
            name="analytics.measurementId"
            type="text"
            autoCapitalize="characters"
            defaultValue={
              settings.analytics.provider === "google"
                ? settings.analytics.measurementId
                : ""
            }
            aria-describedby="field-analytics-measurementId-help"
          />
        </Field>
      </FieldGroup>
    </EditForm>
  );
}
