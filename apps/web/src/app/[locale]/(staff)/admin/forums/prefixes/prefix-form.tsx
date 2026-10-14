import type {
  paletteColorsList,
  threadPrefixesList,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { InputRow, PositionActiveRows } from "@/components/staff/entity-rows";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
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

// The form of a prefix, for a new one (no `prefix`) or a change. The forums a prefix applies to
// and whether a forum requires one are not something the backend has: a prefix is offered
// everywhere. The colours are those of the prefix palette (`isActive` ones, and the current).
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
    <FormRows
      action={savePrefix}
      id={prefix ? undefined : "new"}
      heading={prefix ? t("headingEdit") : t("headingNew")}
      description={prefix ? undefined : t("descriptionNew")}
      submit={prefix ? undefined : t("create")}
    >
      {prefix && <input type="hidden" name="id" value={prefix.id} />}
      <InputRow
        name="label"
        label={t("label")}
        idPrefix={key}
        required
        defaultValue={prefix?.label}
      />
      <FieldRow name="colorId" label={t("colour")} help={t("colourHelp")}>
        <Swatches
          prefix={prefix}
          colours={colours}
          label={t("colour")}
          idPrefix={key}
        />
      </FieldRow>
      <InputRow
        name="icon"
        label={t("icon")}
        idPrefix={key}
        help={t("iconHelp")}
        autoCapitalize="none"
        defaultValue={prefix?.icon}
      />
      <PositionActiveRows
        idPrefix={key}
        position={t("position")}
        active={t("active")}
        activeHelp={t("activeHelp")}
        entry={prefix}
      />
    </FormRows>
  );
}
