import type { noticesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Advanced, Field, FieldGroup } from "@/components/staff/edit-form";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dateInput } from "./dates";

type NoticeItem = z.output<typeof noticesList.output>["items"][number];

// What a notice is written with: its card of fields, then the closed card of its dates. `notice`
// is what the backend returned for an existing notice; without it the fields start empty
// (dismissible and active).
export async function NoticeFields({
  notice,
  prefix,
}: {
  notice?: NoticeItem;
  prefix: string;
}) {
  const t = await getTranslations("adminCommunication.notices.fields");
  const id = (name: string) => `${prefix}-${name}`;
  return (
    <>
      <FieldGroup legend={t("group")}>
        <Field name="title" label={t("title")} htmlFor={id("title")}>
          <Input
            id={id("title")}
            name="title"
            required
            defaultValue={notice?.title}
          />
        </Field>
        <Field
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
        </Field>
        <RuleField place="notice" owner={notice?.id} rule={notice?.rule} />
        <Field
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
        </Field>
        <Field name="active" label={t("active")} htmlFor={id("active")}>
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
        </Field>
      </FieldGroup>
      <Advanced label={t("schedule")} fields={["startsAt", "endsAt"]}>
        <Field
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
        </Field>
        <Field name="endsAt" label={t("endsAt")} htmlFor={id("ends")}>
          <Input
            id={id("ends")}
            name="endsAt"
            type="datetime-local"
            defaultValue={dateInput(notice?.endsAt ?? null)}
          />
        </Field>
      </Advanced>
    </>
  );
}
