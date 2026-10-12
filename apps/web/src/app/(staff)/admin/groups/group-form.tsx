import type { groupsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveGroup } from "./actions";
import { ColourPicker } from "./colour-picker";

type Group = z.output<typeof groupsGet.output>;

// The group form, for a new group (no `group`) or one being edited. The values are what the
// backend returned; a new group starts with the rank the backend's own default suggests.
export async function GroupForm({ group }: { group?: Group }) {
  const t = await getTranslations("adminGroups.form");
  return (
    <FormRows
      action={saveGroup}
      id={group ? undefined : "new"}
      heading={group ? t("headingEdit") : t("headingNew")}
      description={group ? undefined : t("descriptionNew")}
      submit={group ? undefined : t("create")}
    >
      {group && <input type="hidden" name="id" value={group.id} />}
      <ConfirmPassword id={group ? "group-password" : "new-group-password"} />
      <FieldRow name="title" label={t("title")} htmlFor="group-title">
        <Input
          id="group-title"
          name="title"
          required
          defaultValue={group?.title}
        />
      </FieldRow>
      <FieldRow
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
      </FieldRow>
      <FieldRow
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
        />
      </FieldRow>
      <FieldRow
        name="userTitle"
        label={t("userTitle")}
        htmlFor="group-user-title"
        help={t("userTitleHelp")}
      >
        <Input
          id="group-user-title"
          name="userTitle"
          defaultValue={group?.userTitle}
        />
      </FieldRow>
      <FieldRow
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
        />
      </FieldRow>
      <FieldRow
        name="nameColorId"
        label={t("nameColour")}
        help={t("nameColourHelp")}
      >
        <ColourPicker current={group?.nameColorId ?? null} />
      </FieldRow>
      <FieldRow name="isStaff" label={t("isStaff")} htmlFor="group-is-staff">
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
      </FieldRow>
    </FormRows>
  );
}
