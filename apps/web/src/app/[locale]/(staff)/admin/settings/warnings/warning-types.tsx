import { warningTypesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ConfirmStep } from "@/components/staff/confirm-step";
import {
  DeleteBox,
  EditDisclosure,
  EntryList,
} from "@/components/staff/entity-list";
import { CheckRow, InputRow } from "@/components/staff/entity-rows";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { read } from "@/lib/sermo/client";
import { deleteWarningType, saveWarningType } from "./actions";

type WarningType = z.output<typeof warningTypesList.output>["items"][number];

// The form of a warning type, for a new one (no `type`) or a change.
async function TypeForm({ type }: { type?: WarningType }) {
  const t = await getTranslations("adminSetup.warningTypes.form");
  const key = `warning-type-${type?.id ?? "new"}`;
  return (
    <FormRows
      action={saveWarningType}
      id={type ? undefined : "new"}
      heading={type ? t("headingEdit") : t("headingNew")}
      description={type ? undefined : t("descriptionNew")}
      submit={type ? undefined : t("create")}
    >
      {type && <input type="hidden" name="id" value={type.id} />}
      <InputRow
        name="nameEn"
        label={t("nameEn")}
        idPrefix={key}
        required
        maxLength={60}
        defaultValue={type?.nameEn}
      />
      <InputRow
        name="nameEs"
        label={t("nameEs")}
        idPrefix={key}
        required
        maxLength={60}
        defaultValue={type?.nameEs}
      />
      <InputRow
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
      <InputRow
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
      <FieldRow
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
      </FieldRow>
      <CheckRow
        name="locked"
        label={t("locked")}
        text={t("lockedHelp")}
        defaultChecked={type?.locked ?? false}
      />
    </FormRows>
  );
}

// Every warning type, each with its editor and its delete behind a disclosure, then the form for
// a new one. Warnings given under a deleted type stay as they are.
export async function WarningTypes() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminSetup.warningTypes"),
    read(warningTypesList, {}),
  ]);
  return (
    <>
      <EntryList
        heading={t("heading")}
        description={t("description")}
        none={t("none")}
        items={items.map((type) => (
          <li key={type.id}>
            <EditDisclosure
              summaryClass="min-h-12"
              edit={t("edit")}
              summary={
                <>
                  <span className="text-sm font-medium [overflow-wrap:anywhere]">
                    {type.name}
                  </span>
                  <Badge variant="secondary">
                    {t("points", { count: type.points })}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {type.expiryDays === null
                      ? t("neverExpires")
                      : t("expiresAfter", { days: type.expiryDays })}
                  </span>
                  {type.locked && (
                    <Badge variant="outline">{t("locked")}</Badge>
                  )}
                </>
              }
            >
              <TypeForm type={type} />
              <DeleteBox>
                <ConfirmStep
                  action={deleteWarningType}
                  fields={{ id: type.id }}
                  summary={`${t("delete")}…`}
                  warning={t("deleteWarning")}
                  submit={t("delete")}
                />
              </DeleteBox>
            </EditDisclosure>
          </li>
        ))}
      />
      <TypeForm />
    </>
  );
}
