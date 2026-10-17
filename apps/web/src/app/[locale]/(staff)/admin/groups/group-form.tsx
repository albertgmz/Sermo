import type { groupsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveGroup } from "./actions";
import { ColourPicker } from "./colour-picker";
import { ConfirmField } from "./confirm-field";

type Group = z.output<typeof groupsGet.output>;

// The group form, for a new group (no `group`) or one being edited. The values are what the
// backend returned; a new group starts with the rank the backend's own default suggests.
export async function GroupForm({ group }: { group?: Group }) {
  const t = await getTranslations("adminGroups.form");
  return (
    <EditForm action={saveGroup} submit={group ? undefined : t("create")}>
      {group && <input type="hidden" name="id" value={group.id} />}
      <FieldGroup legend={t("sectionGeneral")}>
        <Field name="title" label={t("title")} htmlFor="group-title">
          <Input
            id="group-title"
            name="title"
            required
            defaultValue={group?.title}
          />
        </Field>
        <Field
          name="description"
          label={t("description")}
          htmlFor="group-description"
        >
          <Textarea
            id="group-description"
            name="description"
            rows={3}
            defaultValue={group?.description}
          />
        </Field>
        <Field
          name="rank"
          label={t("rank")}
          htmlFor="group-rank"
          help={t("rankHelp")}
        >
          <Input
            id="group-rank"
            name="rank"
            type="number"
            inputMode="numeric"
            required={Boolean(group)}
            defaultValue={group?.rank}
            aria-describedby="group-rank-help"
          />
        </Field>
        <Field name="isStaff" label={t("isStaff")} htmlFor="group-is-staff">
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="group-is-staff"
              type="checkbox"
              name="isStaff"
              defaultChecked={group?.isStaff}
              className="size-5"
            />
            {t("isStaffHelp")}
          </label>
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("sectionAppearance")}>
        <Field
          name="userTitle"
          label={t("userTitle")}
          htmlFor="group-user-title"
          help={t("userTitleHelp")}
        >
          <Input
            id="group-user-title"
            name="userTitle"
            defaultValue={group?.userTitle}
            aria-describedby="group-user-title-help"
          />
        </Field>
        <Field
          name="badge"
          label={t("badge")}
          htmlFor="group-badge"
          help={t("badgeHelp")}
        >
          <Input
            id="group-badge"
            name="badge"
            autoCapitalize="none"
            defaultValue={group?.badge}
            aria-describedby="group-badge-help"
          />
        </Field>
        <Field
          name="nameColorId"
          label={t("nameColour")}
          help={t("nameColourHelp")}
        >
          <ColourPicker current={group?.nameColorId ?? null} />
        </Field>
      </FieldGroup>
      <ConfirmField id="group-password" />
    </EditForm>
  );
}
