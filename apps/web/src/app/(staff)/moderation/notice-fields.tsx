// The rows every moderation decision shares (the backend's notice fields): a reason kept in the
// moderator log, whether to tell the member, and an optional message to them. Inside a
// `FormRows`; `idPrefix` keeps the ids apart when two forms are on a page.

import { useTranslations } from "next-intl";
import { FieldRow } from "@/components/staff/form-rows";
import { Textarea } from "@/components/ui/textarea";

export function NoticeFields({ idPrefix }: { idPrefix: string }) {
  const t = useTranslations("moderation.noticeFields");
  return (
    <>
      <FieldRow
        name="reason"
        label={t("reason")}
        htmlFor={`${idPrefix}-reason`}
        help={t("reasonHelp")}
      >
        <Textarea
          id={`${idPrefix}-reason`}
          name="reason"
          rows={3}
          maxLength={1000}
        />
      </FieldRow>
      <FieldRow
        name="notify"
        label={t("notify")}
        htmlFor={`${idPrefix}-notify`}
        help={t("notifyHelp")}
      >
        <input
          id={`${idPrefix}-notify`}
          type="checkbox"
          name="notify"
          defaultChecked
          className="size-5"
        />
      </FieldRow>
      <FieldRow
        name="message"
        label={t("message")}
        htmlFor={`${idPrefix}-message`}
        help={t("messageHelp")}
      >
        <Textarea
          id={`${idPrefix}-message`}
          name="message"
          rows={2}
          maxLength={1000}
        />
      </FieldRow>
    </>
  );
}
