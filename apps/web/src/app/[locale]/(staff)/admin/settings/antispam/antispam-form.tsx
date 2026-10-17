import { SIGNATURE_FORMATS, TURNSTILE_FORMS } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EditForm, FieldGroup } from "@/components/staff/edit-form";
import { RuleField } from "@/components/staff/rule-field";
import { saveAntispam } from "../actions";
import { getSettings } from "../data";
import {
  ChecklistRow,
  NumberRow,
  SecretRow,
  SwitchRow,
  TextRow,
} from "../fields";
import { Shown } from "../shown";

export async function AntispamForm() {
  const [t, formats, forms, settings] = await Promise.all([
    getTranslations("adminSetup.pages.antispam"),
    getTranslations("adminSetup.signatureFormats"),
    getTranslations("adminSetup.turnstileForms"),
    getSettings(),
  ]);
  return (
    <EditForm action={saveAntispam}>
      <FieldGroup legend={t("posting")}>
        <NumberRow name="floodSeconds" value={settings.floodSeconds} />
        <Shown name="linksRule" />
        <RuleField
          place="postLinks"
          name="linksRule"
          rule={settings.linksRule}
        />
        <Shown name="approvalRule" />
        <RuleField
          place="postApproval"
          name="approvalRule"
          rule={settings.approvalRule}
        />
      </FieldGroup>
      <FieldGroup legend={t("signatures")} description={t("signaturesNote")}>
        <NumberRow
          name="signatureMaxLength"
          value={settings.signatureMaxLength}
        />
        <NumberRow
          name="signatureMaxLines"
          value={settings.signatureMaxLines}
        />
        <NumberRow
          name="signatureMaxLinks"
          value={settings.signatureMaxLinks}
        />
        <NumberRow
          name="signatureMaxImages"
          value={settings.signatureMaxImages}
        />
        <NumberRow
          name="signatureMaxSmilies"
          value={settings.signatureMaxSmilies}
        />
        <NumberRow
          name="signatureMaxTextSize"
          value={settings.signatureMaxTextSize}
        />
        <ChecklistRow
          name="signatureFormats"
          options={SIGNATURE_FORMATS.map((kind) => ({
            kind,
            label: formats(kind),
          }))}
          value={settings.signatureFormats}
        />
        <Shown name="signatureRule" />
        <RuleField
          place="signature"
          name="signatureRule"
          rule={settings.signatureRule}
        />
      </FieldGroup>
      <FieldGroup legend={t("turnstile")} description={t("turnstileNote")}>
        <SwitchRow name="turnstileEnabled" value={settings.turnstileEnabled} />
        <TextRow
          name="turnstileSiteKey"
          value={settings.turnstileSiteKey}
          autoCapitalize="none"
        />
        <SecretRow
          name="turnstileSecret"
          stored={settings.turnstileSecretSet}
        />
        <ChecklistRow
          name="turnstileForms"
          options={TURNSTILE_FORMS.map((kind) => ({
            kind,
            label: forms(kind),
            // A wrong secret refuses every guarded form, and a signed-out administrator cannot
            // get past sign-in to correct it.
            note: kind === "login" ? t("loginWarning") : undefined,
          }))}
          value={settings.turnstileForms}
        />
      </FieldGroup>
    </EditForm>
  );
}
