import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Row } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { mailAvailable } from "@/lib/sermo/auth";
import { getSettings } from "../settings/data";
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
    <FieldRow name={name} label={label} htmlFor={id} help={help}>
      <div className="flex items-center gap-2">
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
    </FieldRow>
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
    <FormRows
      action={saveEmail}
      heading={t("heading")}
      description={t("description")}
    >
      <Row label={t("mail.label")}>
        <p className="flex min-h-10 flex-wrap items-center gap-2 text-sm">
          <Badge variant={mail ? "success" : "secondary"}>
            {mail ? t("mail.on") : t("mail.off")}
          </Badge>
          <span className="text-muted-foreground">
            {mail ? t("mail.onHelp") : t("mail.offHelp")}
          </span>
        </p>
      </Row>
      <NumberField
        name="emailHourlyCap"
        value={settings.emailHourlyCap}
        label={t("emailHourlyCap.label")}
        help={t("emailHourlyCap.help")}
        unit={t("emailHourlyCap.unit")}
      />
      <FieldRow
        name="conversationEmailIncludesBody"
        label={t("conversationEmailIncludesBody.label")}
        htmlFor="field-conversationEmailIncludesBody"
        help={t("conversationEmailIncludesBody.help")}
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
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
      </FieldRow>
      <NumberField
        name="digestInactiveDays"
        value={settings.digestInactiveDays}
        label={t("digestInactiveDays.label")}
        help={t("digestInactiveDays.help")}
        unit={t("digestInactiveDays.unit")}
      />
    </FormRows>
  );
}
