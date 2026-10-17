import { warningTypesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { read } from "@/lib/sermo/client";
import { deleteWarningType, saveWarningType } from "./actions";
import { CheckField, InputField } from "./fields";

export type WarningType = z.output<
  typeof warningTypesList.output
>["items"][number];

// The form of a warning type, for a new one (no `type`) or a change.
export async function TypeForm({ type }: { type?: WarningType }) {
  const t = await getTranslations("adminSetup.warningTypes.form");
  const key = `warning-type-${type?.id ?? "new"}`;
  return (
    <EditForm action={saveWarningType} submit={type ? undefined : t("create")}>
      <FieldGroup legend={type?.name ?? t("legend")}>
        {type && <input type="hidden" name="id" value={type.id} />}
        <InputField
          name="nameEn"
          label={t("nameEn")}
          idPrefix={key}
          required
          maxLength={60}
          defaultValue={type?.nameEn}
        />
        <InputField
          name="nameEs"
          label={t("nameEs")}
          idPrefix={key}
          required
          maxLength={60}
          defaultValue={type?.nameEs}
        />
        <InputField
          name="points"
          label={t("points")}
          idPrefix={key}
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          required
          help={t("pointsHelp")}
          defaultValue={type?.points}
        />
        <InputField
          name="expiryDays"
          label={t("expiryDays")}
          idPrefix={key}
          type="number"
          inputMode="numeric"
          min={1}
          max={3650}
          help={t("expiryDaysHelp")}
          defaultValue={type?.expiryDays ?? undefined}
        />
        <Field
          name="defaultReason"
          label={t("defaultReason")}
          htmlFor={`${key}-defaultReason`}
          help={t("defaultReasonHelp")}
        >
          <Textarea
            id={`${key}-defaultReason`}
            name="defaultReason"
            rows={2}
            defaultValue={type?.defaultReason}
          />
        </Field>
        <CheckField
          name="locked"
          label={t("locked")}
          text={t("lockedHelp")}
          defaultChecked={type?.locked ?? false}
        />
      </FieldGroup>
    </EditForm>
  );
}

// Every warning type, each row leading to its own page; the delete step is on the row. Warnings
// given under a deleted type stay as they are.
export async function WarningTypes() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminSetup.warningTypes"),
    read(warningTypesList, {}),
  ]);
  return (
    <ItemList
      label={t("heading")}
      heading={t("heading")}
      description={t("description")}
      items={items.map((type) => ({
        id: type.id,
        title: type.name,
        href: `/admin/settings/warnings/types/${type.id}`,
        description:
          type.expiryDays === null
            ? t("neverExpires")
            : t("expiresAfter", { days: type.expiryDays }),
        badges: (
          <>
            <Badge variant="secondary">
              {t("points", { count: type.points })}
            </Badge>
            {type.locked && <Badge variant="outline">{t("locked")}</Badge>}
          </>
        ),
        actions: (
          <>
            <RowLink
              href={`/admin/settings/warnings/types/${type.id}`}
              label={t("editLabel", { name: type.name })}
            />
            <ConfirmStep
              action={deleteWarningType}
              fields={{ id: type.id }}
              summary={`${t("delete")}…`}
              warning={t("deleteWarning")}
              submit={t("delete")}
            />
          </>
        ),
      }))}
      empty={{ title: t("none") }}
    />
  );
}
