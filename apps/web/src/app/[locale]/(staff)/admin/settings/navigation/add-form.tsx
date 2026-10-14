import type { navigationList } from "@sermo/core/contracts";
import {
  NavigationAudience,
  NavigationIconPosition,
  NavigationLocation,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { IconPicker } from "@/components/icons/icon-picker";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { addEntry } from "./actions";

type Entries = z.output<typeof navigationList.output>["items"];

// The form that adds an entry. The targets offered are the ones the site's own entries go to.
export async function AddForm({
  entries,
  permissions,
}: {
  entries: Entries;
  permissions: string[] | null;
}) {
  const t = await getTranslations("adminSetup.navigation");
  const places = NavigationLocation.options;
  const targets = [
    ...new Set(
      entries
        .filter((entry) => entry.builtin !== null && entry.target !== null)
        .map((entry) => entry.target as string),
    ),
  ];
  const tops = entries.filter((entry) => entry.parentId === null);
  return (
    <FormRows
      action={addEntry}
      id="new"
      heading={t("add.heading")}
      description={t("add.description")}
      submit={t("add.submit")}
    >
      <FieldRow
        name="location"
        label={t("add.location")}
        htmlFor="add-location"
        help={t("add.locationHelp")}
      >
        <select id="add-location" name="location" className={selectClass}>
          {places.map((place) => (
            <option key={place} value={place}>
              {t(`locations.${place}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow name="title" label={t("add.title")} htmlFor="add-title">
        <Input id="add-title" name="title" required />
      </FieldRow>
      <FieldRow
        name="target"
        label={t("add.target")}
        htmlFor="add-target"
        help={t("add.targetHelp")}
      >
        <Input
          id="add-target"
          name="target"
          list="add-targets"
          autoCapitalize="none"
          spellCheck={false}
          aria-describedby="add-target-help"
        />
        <datalist id="add-targets">
          {targets.map((target) => (
            <option key={target} value={target} />
          ))}
        </datalist>
      </FieldRow>
      <FieldRow
        name="icon"
        label={t("add.icon")}
        htmlFor="add-icon"
        help={t("add.iconHelp")}
      >
        <IconPicker name="icon" id="add-icon" labelId="add-icon-label" />
      </FieldRow>
      <FieldRow
        name="iconPosition"
        label={t("add.iconPosition")}
        htmlFor="add-icon-position"
      >
        <select
          id="add-icon-position"
          name="iconPosition"
          className={selectClass}
        >
          {NavigationIconPosition.options.map((position) => (
            <option key={position} value={position}>
              {t(`iconPositions.${position}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="parentId"
        label={t("add.parent")}
        htmlFor="add-parent"
        help={t("add.parentHelp")}
      >
        <select id="add-parent" name="parentId" className={selectClass}>
          <option value="">{t("add.noParent")}</option>
          {places.map((place) => (
            <optgroup key={place} label={t(`locations.${place}`)}>
              {tops
                .filter((entry) => entry.location === place)
                .map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="position"
        label={t("add.order")}
        htmlFor="add-order"
        help={t("add.orderHelp")}
      >
        <Input
          id="add-order"
          name="position"
          type="number"
          inputMode="numeric"
        />
      </FieldRow>
      <FieldRow
        name="audience"
        label={t("add.audience")}
        htmlFor="add-audience"
      >
        <select id="add-audience" name="audience" className={selectClass}>
          {NavigationAudience.options.map((audience) => (
            <option key={audience} value={audience}>
              {t(`audiences.${audience}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="permission"
        label={t("add.permission")}
        htmlFor="add-permission"
        help={t("add.permissionHelp")}
      >
        {permissions ? (
          <select id="add-permission" name="permission" className={selectClass}>
            <option value="">{t("add.noPermission")}</option>
            {permissions.map((permission) => (
              <option key={permission} value={permission}>
                {permission}
              </option>
            ))}
          </select>
        ) : (
          <Input id="add-permission" name="permission" autoCapitalize="none" />
        )}
      </FieldRow>
      <FieldRow name="isEnabled" label={t("add.enabled")} htmlFor="add-enabled">
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            id="add-enabled"
            type="checkbox"
            name="isEnabled"
            defaultChecked
            className="size-5"
          />
          {t("add.enabled")}
        </label>
      </FieldRow>
    </FormRows>
  );
}
