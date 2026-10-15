import type { awardsGet } from "@sermo/core/contracts";
import { awardsCreate } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { PictureField } from "@/components/staff/picture-field";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { saveAward } from "./actions";

export type Award = z.output<typeof awardsGet.output>;

const TIERS = awardsCreate.input.shape.tier.options;
const checkbox = "size-5";

// The award form, for a new award (no `award`) or one being edited. A rule with no conditions
// means the award is given by hand only.
export async function AwardForm({ award }: { award?: Award }) {
  const t = await getTranslations("adminEconomy.awards.form");
  const key = `award-${award?.id ?? "new"}`;
  return (
    <FormRows
      action={saveAward}
      id={award ? undefined : "new"}
      heading={award ? t("headingEdit") : t("headingNew")}
      description={award ? undefined : t("descriptionNew")}
      submit={award ? undefined : t("create")}
    >
      {award && <input type="hidden" name="id" value={award.id} />}
      <FieldRow name="name" label={t("name")} htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          name="name"
          required
          defaultValue={award?.name}
        />
      </FieldRow>
      <FieldRow
        name="description"
        label={t("description")}
        htmlFor={`${key}-description`}
      >
        <Input
          id={`${key}-description`}
          name="description"
          defaultValue={award?.description}
        />
      </FieldRow>
      <FieldRow name="tier" label={t("tier")} htmlFor={`${key}-tier`}>
        <select
          id={`${key}-tier`}
          name="tier"
          defaultValue={award?.tier ?? TIERS[0]}
          className={selectClass}
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {t(`tiers.${tier}`)}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        name="xp"
        label={t("xp")}
        htmlFor={`${key}-xp`}
        help={t("xpHelp")}
      >
        <Input
          id={`${key}-xp`}
          name="xp"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={award?.xp ?? 0}
        />
      </FieldRow>
      <FieldRow
        name="credits"
        label={t("credits")}
        htmlFor={`${key}-credits`}
        help={t("creditsHelp")}
      >
        <Input
          id={`${key}-credits`}
          name="credits"
          type="number"
          inputMode="numeric"
          min={0}
          required
          defaultValue={award?.credits ?? 0}
        />
      </FieldRow>
      <FieldRow
        name="fileId"
        label={t("picture")}
        htmlFor={`${key}-file`}
        help={t("pictureHelp")}
      >
        <PictureField
          purpose="award_image"
          name="fileId"
          id={`${key}-file`}
          removable
          current={
            award?.image ? (
              <Art
                category="awards"
                src={award.image.url}
                className="aspect-video h-12 rounded-md border"
              />
            ) : undefined
          }
        />
      </FieldRow>
      <FieldRow
        name="icon"
        label={t("icon")}
        htmlFor={`${key}-icon`}
        help={t("iconHelp")}
      >
        <Input
          id={`${key}-icon`}
          name="icon"
          autoCapitalize="none"
          defaultValue={award?.icon}
        />
      </FieldRow>
      <FieldRow name="isStackable" label={t("stackable")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isStackable"
            defaultChecked={award?.isStackable ?? false}
            className={checkbox}
          />
          {t("stackableHelp")}
        </label>
      </FieldRow>
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={award ? award.isActive : true}
            className={checkbox}
          />
          {t("activeHelp")}
        </label>
      </FieldRow>
      <RuleField place="award" owner={award?.id} rule={award?.rule} />
    </FormRows>
  );
}
