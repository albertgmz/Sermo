import { getTranslations } from "next-intl/server";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { mailAvailable } from "@/lib/sermo/auth";
import { getSettings } from "../settings/data";
import { Shown } from "../settings/shown";
import { saveEmail } from "./actions";

function NumberField({
  name,
  value,
  label,
  help,
  unit,
}: {
  name: string;
  value: number;
  label: string;
  help: string;
  unit: string;
}) {
  const id = `field-${name}`;
  return (
    <Field name={name} label={label} htmlFor={id} help={help}>
      <div className="flex items-center gap-2">
        <Shown name={name} />
        <Input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          required
          defaultValue={value}
          aria-describedby={`${id}-help`}
        />
        <span className="shrink-0 text-sm text-muted-foreground">{unit}</span>
      </div>
    </Field>
  );
}

// The email settings, after the line that says whether this site can send mail at all.
export async function EmailForm() {
  const [t, settings] = await Promise.all([
    getTranslations("adminCommunication.email"),
    getSettings(),
  ]);
  const mail = await mailAvailable();
  return (
    <EditForm action={saveEmail}>
      <FieldGroup legend={t("heading")} description={t("description")}>
        <Field name="mail" label={t("mail.label")}>
          <p className="flex min-h-10 flex-wrap items-center gap-2 text-sm">
            <Badge variant={mail ? "success" : "secondary"}>
              {mail ? t("mail.on") : t("mail.off")}
            </Badge>
            <span className="text-muted-foreground">
              {mail ? t("mail.onHelp") : t("mail.offHelp")}
            </span>
          </p>
        </Field>
        <NumberField
          name="emailHourlyCap"
          value={settings.emailHourlyCap}
          label={t("emailHourlyCap.label")}
          help={t("emailHourlyCap.help")}
          unit={t("emailHourlyCap.unit")}
        />
        <Field
          name="conversationEmailIncludesBody"
          label={t("conversationEmailIncludesBody.label")}
          htmlFor="field-conversationEmailIncludesBody"
          help={t("conversationEmailIncludesBody.help")}
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <Shown name="conversationEmailIncludesBody" />
            <input
              id="field-conversationEmailIncludesBody"
              type="checkbox"
              name="conversationEmailIncludesBody"
              defaultChecked={settings.conversationEmailIncludesBody}
              aria-describedby="field-conversationEmailIncludesBody-help"
              className="size-5"
            />
            {t("conversationEmailIncludesBody.switch")}
          </label>
        </Field>
        <NumberField
          name="digestInactiveDays"
          value={settings.digestInactiveDays}
          label={t("digestInactiveDays.label")}
          help={t("digestInactiveDays.help")}
          unit={t("digestInactiveDays.unit")}
        />
      </FieldGroup>
    </EditForm>
  );
}
