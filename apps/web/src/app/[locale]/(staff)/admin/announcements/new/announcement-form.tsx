import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { sendAnnouncement } from "../actions";

// The announcement form. The last row is the confirmation: it says how far the announcement goes
// and the action refuses to send without it ticked.
export async function AnnouncementForm() {
  const t = await getTranslations("adminCommunication.announcements.form");
  return (
    <FormRows
      action={sendAnnouncement}
      heading={t("heading")}
      description={t("description")}
      submit={t("send")}
    >
      <FieldRow name="title" label={t("title")} htmlFor="announcement-title">
        <Input id="announcement-title" name="title" required />
      </FieldRow>
      <FieldRow
        name="body"
        label={t("body")}
        htmlFor="announcement-body"
        help={t("bodyHelp")}
      >
        <Textarea
          id="announcement-body"
          name="body"
          required
          rows={8}
          aria-describedby="announcement-body-help"
        />
      </FieldRow>
      <FieldRow
        name="confirm"
        label={t("confirm")}
        htmlFor="announcement-confirm"
        help={t("confirmWarning")}
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id="announcement-confirm"
            type="checkbox"
            name="confirm"
            aria-describedby="announcement-confirm-help"
            className="size-5"
          />
          {t("confirmBox")}
        </label>
      </FieldRow>
    </FormRows>
  );
}
