import type { awardCategoriesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Field, FieldGroup } from "@/components/staff/edit-form";
import { Input } from "@/components/ui/input";

export type AwardCategory = z.output<
  typeof awardCategoriesList.output
>["items"][number];

// The fields of an award category, for a new one (no `category`) or a change, inside the page's
// `EditForm`. Its place is changed on the sort page; a new one goes last.
export async function AwardCategoryFormFields({
  category,
}: {
  category?: AwardCategory;
}) {
  const t = await getTranslations("adminEconomy.awardCategories.form");
  const key = `award-category-${category?.id ?? "new"}`;
  return (
    <>
      {category && <input type="hidden" name="id" value={category.id} />}
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field name="title" label={t("title")} htmlFor={`${key}-title`}>
          <Input
            id={`${key}-title`}
            name="title"
            required
            maxLength={100}
            defaultValue={category?.title}
            aria-describedby={`${key}-title-error`}
          />
        </Field>
        <Field
          name="description"
          label={t("description")}
          htmlFor={`${key}-description`}
          help={t("descriptionHelp")}
        >
          <Input
            id={`${key}-description`}
            name="description"
            maxLength={500}
            defaultValue={category?.description}
            aria-describedby={`${key}-description-help ${key}-description-error`}
          />
        </Field>
      </FieldGroup>
    </>
  );
}
