import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { groupsIfAllowed } from "../../groups/data";
import { sendAnnouncement } from "../actions";

// The alert form: who gets it (everyone, a group or named members), the optional link it opens and
// the text. The last row is the confirmation: the action refuses to send without it ticked. The
// group list is the one the viewer may read; without it the alert goes to everyone or to named
// members.
export async function AnnouncementForm() {
  const [t, groups] = await Promise.all([
    getTranslations("adminCommunication.announcements.form"),
    groupsIfAllowed(),
  ]);
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
        name="url"
        label={t("url")}
        htmlFor="announcement-url"
        help={t("urlHelp")}
      >
        <Input
          id="announcement-url"
          name="url"
          maxLength={500}
          aria-describedby="announcement-url-help"
        />
      </FieldRow>
      <FieldRow
        name="audience"
        label={t("audience")}
        htmlFor="announcement-audience"
        help={t("audienceHelp")}
      >
        <select
          id="announcement-audience"
          name="audience"
          defaultValue="all"
          className={selectClass}
        >
          <option value="all">{t("audienceAll")}</option>
          {groups && <option value="group">{t("audienceGroup")}</option>}
          <option value="users">{t("audienceUsers")}</option>
        </select>
      </FieldRow>
      {groups && (
        <FieldRow
          name="groupId"
          label={t("group")}
          htmlFor="announcement-group"
        >
          <select
            id="announcement-group"
            name="groupId"
            className={selectClass}
          >
            <option value="">{t("groupNone")}</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.title}
              </option>
            ))}
          </select>
        </FieldRow>
      )}
      <FieldRow
        name="usernames"
        label={t("usernames")}
        htmlFor="announcement-usernames"
        help={t("usernamesHelp")}
      >
        <Input
          id="announcement-usernames"
          name="usernames"
          aria-describedby="announcement-usernames-help"
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
