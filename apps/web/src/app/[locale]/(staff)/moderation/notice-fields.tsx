// The rows every moderation decision shares (the backend's notice fields): a reason kept in the
// moderator log, whether to tell the member, and an optional message to them. Inside a
// `FormRows`; `idPrefix` keeps the ids apart when two forms are on a page.

import { useTranslations } from "next-intl";
import { Field } from "@/components/staff/edit-form";
import { Textarea } from "@/components/ui/textarea";

export function NoticeFields({ idPrefix }: { idPrefix: string }) {
  const t = useTranslations("moderation.noticeFields");
  return (
    <>
      <Field
        name="reason"
        label={t("reason")}
        htmlFor={`${idPrefix}-reason`}
        help={t("reasonHelp")}
      >
        <Textarea id={`${idPrefix}-reason`} name="reason" rows={3} />
      </Field>
      <Field
        name="notify"
        label={t("notify")}
        htmlFor={`${idPrefix}-notify`}
        help={t("notifyHelp")}
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id={`${idPrefix}-notify`}
            type="checkbox"
            name="notify"
            defaultChecked
            className="size-5"
          />
          {t("notifyYes")}
        </label>
      </Field>
      <Field
        name="message"
        label={t("message")}
        htmlFor={`${idPrefix}-message`}
        help={t("messageHelp")}
      >
        <Textarea id={`${idPrefix}-message`} name="message" rows={2} />
      </Field>
    </>
  );
}
