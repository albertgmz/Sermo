import type {
  paletteColorsList,
  threadPrefixesList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { EditForm, Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";
import { savePrefix } from "../actions";

export type Prefix = z.output<
  typeof threadPrefixesList.output
>["items"][number];
export type PrefixColour = z.output<
  typeof paletteColorsList.output
>["items"][number];

// The swatches of the prefix palette as radio buttons, each drawn as the prefix tag would be.
// The colour the prefix has now stays an option when the palette no longer offers it (inactive).
function Swatches({
  prefix,
  colours,
  label,
  idPrefix,
}: {
  prefix?: Prefix;
  colours: readonly PrefixColour[];
  label: string;
  idPrefix: string;
}) {
  const current = prefix?.colorId;
  const offered = colours.filter(
    (colour) => colour.isActive || colour.id === current,
  );
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">{label}</legend>
      {offered.map((colour) => (
        <label key={colour.id} className="relative">
          <input
            type="radio"
            name="colorId"
            value={colour.id}
            required
            defaultChecked={colour.id === current}
            id={`${idPrefix}-colour-${colour.id}`}
            className="peer sr-only"
          />
          <span className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm peer-checked:border-ring peer-checked:bg-muted peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50">
            <PrefixTag
              prefix={{
                label: colour.name,
                color: colour.color,
                icon: "",
              }}
              icon={false}
            />
          </span>
        </label>
      ))}
    </fieldset>
  );
}

// The form of a prefix, for a new one (no `prefix`) or a change. Which forums offer a prefix is
// set on each forum's page; a new prefix can start offered in all of them. The colours are those
// of the prefix palette (`isActive` ones, and the current).
export async function PrefixForm({
  prefix,
  colours,
}: {
  prefix?: Prefix;
  colours: readonly PrefixColour[];
}) {
  const t = await getTranslations("adminForums.prefixForm");
  const key = `prefix-${prefix?.id ?? "new"}`;
  return (
    <EditForm action={savePrefix} submit={prefix ? undefined : t("create")}>
      {prefix && <input type="hidden" name="id" value={prefix.id} />}
      <FieldGroup legend={t("legend")}>
        <Field name="label" label={t("label")} htmlFor={`${key}-label`}>
          <Input
            id={`${key}-label`}
            name="label"
            required
            defaultValue={prefix?.label}
          />
        </Field>
        <Field name="colorId" label={t("colour")} help={t("colourHelp")}>
          <Swatches
            prefix={prefix}
            colours={colours}
            label={t("colour")}
            idPrefix={key}
          />
        </Field>
        <Field
          name="icon"
          label={t("icon")}
          htmlFor={`${key}-icon`}
          help={t("iconHelp")}
        >
          <Input
            id={`${key}-icon`}
            name="icon"
            autoCapitalize="none"
            defaultValue={prefix?.icon}
          />
        </Field>
        <Field
          name="position"
          label={t("position")}
          htmlFor={`${key}-position`}
        >
          <Input
            id={`${key}-position`}
            name="position"
            type="number"
            inputMode="numeric"
            defaultValue={prefix?.position}
          />
        </Field>
        <Field name="isActive" label={t("active")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={prefix ? prefix.isActive : true}
              className="size-5"
            />
            {t("activeHelp")}
          </label>
        </Field>
        {!prefix && (
          <Field name="offerInAllForums" label={t("offerInAllForums")}>
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                type="checkbox"
                name="offerInAllForums"
                defaultChecked
                className="size-5"
              />
              {t("offerInAllForumsHelp")}
            </label>
          </Field>
        )}
      </FieldGroup>
    </EditForm>
  );
}
