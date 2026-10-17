import {
  NavigationAudience,
  NavigationIconPosition,
  NavigationLocation,
  type navigationList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { IconPicker } from "@/components/icons/icon-picker";
import {
  Advanced,
  EditForm,
  Field,
  FieldGroup,
} from "@/components/staff/edit-form";
import { selectClass } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { addEntry, saveEntry } from "./actions";

type Entries = z.output<typeof navigationList.output>["items"];

// The form of a navigation entry's own page: with `entry` it edits that entry (its place, target
// and parent stay as they are), without it adds one. The targets offered are the ones the site's
// own entries go to.
export async function EntryForm({
  entries,
  permissions,
  entry,
}: {
  entries: Entries;
  permissions: string[] | null;
  entry?: Entries[number];
}) {
  const t = await getTranslations("adminSetup.navigation");
  const places = NavigationLocation.options;
  const targets = [
    ...new Set(
      entries
        .filter((other) => other.builtin !== null && other.target !== null)
        .map((other) => other.target as string),
    ),
  ];
  const tops = entries.filter((other) => other.parentId === null);
  return (
    <EditForm
      action={entry ? saveEntry : addEntry}
      submit={entry ? t("row.save") : t("add.submit")}
    >
      {entry && <input type="hidden" name="id" value={entry.id} />}
      <FieldGroup legend={t("form.entry")}>
        {!entry && (
          <Field
            name="location"
            label={t("add.location")}
            htmlFor="entry-location"
            help={t("add.locationHelp")}
          >
            <select id="entry-location" name="location" className={selectClass}>
              {places.map((place) => (
                <option key={place} value={place}>
                  {t(`locations.${place}`)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field name="title" label={t("add.title")} htmlFor="entry-title">
          <Input
            id="entry-title"
            name="title"
            required
            defaultValue={entry?.title}
          />
        </Field>
        {!entry && (
          <>
            <Field
              name="target"
              label={t("add.target")}
              htmlFor="entry-target"
              help={t("add.targetHelp")}
            >
              <Input
                id="entry-target"
                name="target"
                list="entry-targets"
                autoCapitalize="none"
                spellCheck={false}
                aria-describedby="entry-target-help"
              />
              <datalist id="entry-targets">
                {targets.map((target) => (
                  <option key={target} value={target} />
                ))}
              </datalist>
            </Field>
            <Field
              name="parentId"
              label={t("add.parent")}
              htmlFor="entry-parent"
              help={t("add.parentHelp")}
            >
              <select id="entry-parent" name="parentId" className={selectClass}>
                <option value="">{t("add.noParent")}</option>
                {places.map((place) => (
                  <optgroup key={place} label={t(`locations.${place}`)}>
                    {tops
                      .filter((other) => other.location === place)
                      .map((other) => (
                        <option key={other.id} value={other.id}>
                          {other.title}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </>
        )}
      </FieldGroup>
      <FieldGroup legend={t("form.look")}>
        <Field
          name="icon"
          label={t("add.icon")}
          htmlFor="entry-icon"
          help={t("add.iconHelp")}
        >
          <IconPicker
            name="icon"
            id="entry-icon"
            labelId="entry-icon-label"
            defaultValue={entry?.icon}
          />
        </Field>
        <Field
          name="iconPosition"
          label={t("add.iconPosition")}
          htmlFor="entry-icon-position"
        >
          <select
            id="entry-icon-position"
            name="iconPosition"
            defaultValue={entry?.iconPosition}
            className={selectClass}
          >
            {NavigationIconPosition.options.map((position) => (
              <option key={position} value={position}>
                {t(`iconPositions.${position}`)}
              </option>
            ))}
          </select>
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("form.visibility")}>
        <Field
          name="audience"
          label={t("add.audience")}
          htmlFor="entry-audience"
        >
          <select
            id="entry-audience"
            name="audience"
            defaultValue={entry?.audience}
            className={selectClass}
          >
            {NavigationAudience.options.map((audience) => (
              <option key={audience} value={audience}>
                {t(`audiences.${audience}`)}
              </option>
            ))}
            {entry &&
              !(NavigationAudience.options as readonly string[]).includes(
                entry.audience,
              ) && <option value={entry.audience}>{entry.audience}</option>}
          </select>
        </Field>
        <Field
          name="permission"
          label={t("add.permission")}
          htmlFor="entry-permission"
          help={t("add.permissionHelp")}
        >
          {permissions ? (
            <select
              id="entry-permission"
              name="permission"
              defaultValue={entry?.permission ?? ""}
              className={selectClass}
            >
              <option value="">{t("add.noPermission")}</option>
              {permissions.map((permission) => (
                <option key={permission} value={permission}>
                  {permission}
                </option>
              ))}
            </select>
          ) : (
            <Input
              id="entry-permission"
              name="permission"
              autoCapitalize="none"
              defaultValue={entry?.permission ?? ""}
            />
          )}
        </Field>
        <Field
          name="isEnabled"
          label={t("form.enabledLabel")}
          htmlFor="entry-enabled"
        >
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              id="entry-enabled"
              type="checkbox"
              name="isEnabled"
              defaultChecked={entry ? entry.isEnabled : true}
              className="size-5"
            />
            {t("form.enabled")}
          </label>
        </Field>
      </FieldGroup>
      {!entry && (
        <Advanced fields={["position"]}>
          <Field
            name="position"
            label={t("add.order")}
            htmlFor="entry-order"
            help={t("add.orderHelp")}
          >
            <Input
              id="entry-order"
              name="position"
              type="number"
              inputMode="numeric"
              aria-describedby="entry-order-help"
            />
          </Field>
        </Advanced>
      )}
    </EditForm>
  );
}
