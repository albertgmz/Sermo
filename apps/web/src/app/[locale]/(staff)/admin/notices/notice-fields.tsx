import type { noticesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { FieldRow } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { groupsIfAllowed } from "../groups/data";
import { dateInput } from "./dates";

type NoticeItem = z.output<typeof noticesList.output>["items"][number];

// The rows a notice is written with. `notice` is what the backend returned for an existing notice;
// without it the rows start empty (dismissible and active). The group list is the one the viewer
// may read; without it a notice cannot be aimed at a group.
export async function NoticeFields({
  notice,
  prefix,
}: {
  notice?: NoticeItem;
  prefix: string;
}) {
  const [t, groups] = await Promise.all([
    getTranslations("adminCommunication.notices.fields"),
    groupsIfAllowed(),
  ]);
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <>
      <FieldRow name="title" label={t("title")} htmlFor={id("title")}>
        <Input
          id={id("title")}
          name="title"
          required
          defaultValue={notice?.title}
        />
      </FieldRow>
      <FieldRow
        name="body"
        label={t("body")}
        htmlFor={id("body")}
        help={t("bodyHelp")}
      >
        <Textarea
          id={id("body")}
          name="body"
          required
          rows={6}
          defaultValue={notice?.bodySource}
          aria-describedby={`${id("body")}-help`}
        />
      </FieldRow>
      <FieldRow
        name="audience"
        label={t("audience")}
        htmlFor={id("audience")}
        help={t("audienceHelp")}
      >
        <select
          id={id("audience")}
          name="audience"
          defaultValue={notice?.audience ?? "everyone"}
          className={selectClass}
        >
          <option value="everyone">{t("everyone")}</option>
          <option value="guests">{t("guests")}</option>
          <option value="members">{t("members")}</option>
          {(groups || notice?.audience === "group") && (
            <option value="group">{t("group")}</option>
          )}
        </select>
      </FieldRow>
      {groups && (
        <FieldRow
          name="groupId"
          label={t("groupLabel")}
          htmlFor={id("group")}
          help={t("groupHelp")}
        >
          <select
            id={id("group")}
            name="groupId"
            defaultValue={notice?.groupId ?? ""}
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
        name="dismissible"
        label={t("dismissible")}
        htmlFor={id("dismissible")}
      >
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id={id("dismissible")}
            type="checkbox"
            name="dismissible"
            defaultChecked={notice?.dismissible ?? true}
            className="size-5"
          />
          {t("dismissibleSwitch")}
        </label>
      </FieldRow>
      <FieldRow name="active" label={t("active")} htmlFor={id("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id={id("active")}
            type="checkbox"
            name="active"
            defaultChecked={notice?.active ?? true}
            className="size-5"
          />
          {t("activeSwitch")}
        </label>
      </FieldRow>
      <FieldRow
        name="startsAt"
        label={t("startsAt")}
        htmlFor={id("starts")}
        help={t("dateHelp")}
      >
        <Input
          id={id("starts")}
          name="startsAt"
          type="datetime-local"
          defaultValue={dateInput(notice?.startsAt ?? null)}
          aria-describedby={`${id("starts")}-help`}
        />
      </FieldRow>
      <FieldRow name="endsAt" label={t("endsAt")} htmlFor={id("ends")}>
        <Input
          id={id("ends")}
          name="endsAt"
          type="datetime-local"
          defaultValue={dateInput(notice?.endsAt ?? null)}
        />
      </FieldRow>
    </>
  );
}
