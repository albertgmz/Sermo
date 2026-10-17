import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { Section } from "@/components/staff/rows";
import { getSettings } from "../data";
import { SwitchRow } from "../fields";
import { askEveryoneAgain, saveCookies } from "./actions";

export async function CookiesForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminSetup.pages.cookies"),
    getSettings(),
  ]);
  return (
    <>
      <EditForm action={saveCookies}>
        <FieldGroup legend={t("formHeading")}>
          <SwitchRow
            name="cookieBannerOutsideEu"
            value={settings.cookieBannerOutsideEu}
          />
          <SwitchRow
            name="matomoCookieless"
            value={settings.matomoCookieless}
          />
        </FieldGroup>
      </EditForm>
      <Section heading={t("versionHeading")}>
        <div className="grid gap-3 p-4">
          <p className="text-sm font-medium">
            {t("versionCurrent", { version: settings.cookiePolicyVersion })}
          </p>
          <p className="text-sm text-muted-foreground">{t("versionHelp")}</p>
          <ConfirmStep
            action={askEveryoneAgain}
            summary={t("askAgain")}
            warning={t("askAgainWarning")}
            submit={t("askAgainSubmit")}
            danger={false}
          />
        </div>
      </Section>
    </>
  );
}
