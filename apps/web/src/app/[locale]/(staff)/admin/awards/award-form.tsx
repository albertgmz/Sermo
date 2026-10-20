import type { awardsGet } from "@sermo/core/contracts";
import { awardCategoriesList, awardsCreate } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Art } from "@/components/forum/art";
import { Advanced, Field, FieldGroup } from "@/components/staff/edit-form";
import { PictureField } from "@/components/staff/picture-field";
import { selectClass } from "@/components/staff/rows";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";

export type Award = z.output<typeof awardsGet.output>;

const TIERS = awardsCreate.input.shape.tier.options;

// The help and error lines of a `Field`, by its control's id.
const describedBy = (id: string) => `${id}-help ${id}-error`;

// The fields of an award, for a new one (no `award`) or one being edited, inside the page's
// `EditForm`. A rule with no conditions means the award is given by hand only.
export async function AwardFormFields({ award }: { award?: Award }) {
  const [t, categories] = await Promise.all([
    getTranslations("adminEconomy.awards.form"),
    read(awardCategoriesList, {}),
  ]);
  const key = `award-${award?.id ?? "new"}`;
  return (
    <>
      {award && <input type="hidden" name="id" value={award.id} />}
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field name="name" label={t("name")} htmlFor={`${key}-name`}>
          <Input
            id={`${key}-name`}
            name="name"
            required
            defaultValue={award?.name}
            aria-describedby={`${key}-name-error`}
          />
        </Field>
        <Field
          name="description"
          label={t("description")}
          htmlFor={`${key}-description`}
        >
          <Input
            id={`${key}-description`}
            name="description"
            defaultValue={award?.description}
            aria-describedby={`${key}-description-error`}
          />
        </Field>
        <Field
          name="categoryId"
          label={t("category")}
          htmlFor={`${key}-category`}
          help={t("categoryHelp")}
        >
          <select
            id={`${key}-category`}
            name="categoryId"
            defaultValue={award?.category?.id ?? ""}
            aria-describedby={describedBy(`${key}-category`)}
            className={selectClass}
          >
            <option value="">{t("noCategory")}</option>
            {categories.items.map((category) => (
              <option key={category.id} value={category.id}>
                {category.title}
              </option>
            ))}
          </select>
        </Field>
        <Field
          name="tier"
          label={t("tier")}
          htmlFor={`${key}-tier`}
          help={t("tierHelp")}
        >
          <select
            id={`${key}-tier`}
            name="tier"
            defaultValue={award?.tier ?? TIERS[0]}
            aria-describedby={describedBy(`${key}-tier`)}
            className={selectClass}
          >
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {t(`tiers.${tier}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field
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
            aria-describedby={describedBy(`${key}-xp`)}
            className="w-32"
          />
        </Field>
        <Field
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
            aria-describedby={describedBy(`${key}-credits`)}
            className="w-32"
          />
        </Field>
        <Field
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
        </Field>
        <Field name="isActive" label={t("active")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={award ? award.isActive : true}
              className="size-5"
            />
            {t("activeHelp")}
          </label>
        </Field>
      </FieldGroup>
      <FieldGroup legend={t("automatic")} description={t("automaticHelp")}>
        <RuleField place="award" owner={award?.id} rule={award?.rule} />
      </FieldGroup>
      <Advanced fields={["icon", "isStackable"]}>
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
            defaultValue={award?.icon}
            aria-describedby={describedBy(`${key}-icon`)}
          />
        </Field>
        <Field name="isStackable" label={t("stackable")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isStackable"
              defaultChecked={award?.isStackable ?? false}
              className="size-5"
            />
            {t("stackableHelp")}
          </label>
        </Field>
      </Advanced>
    </>
  );
}
