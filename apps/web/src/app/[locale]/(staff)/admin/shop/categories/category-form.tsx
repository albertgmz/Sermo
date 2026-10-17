import type { shopCategoriesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Advanced, Field, FieldGroup } from "@/components/staff/edit-form";
import { RuleField } from "@/components/staff/rule-field";
import { Input } from "@/components/ui/input";

export type Category = z.output<
  typeof shopCategoriesList.output
>["items"][number];

// The help and error lines of a `Field`, by its control's id.
const describedBy = (id: string) => `${id}-help ${id}-error`;

// The fields of a category, for a new one (no `category`) or a change, inside the page's
// `EditForm`. A new category takes its place from the position; an existing one is moved on the
// sort page, so its form does not carry the position.
export async function CategoryFormFields({
  category,
}: {
  category?: Category;
}) {
  const t = await getTranslations("adminEconomy.categories.form");
  const key = `category-${category?.id ?? "new"}`;
  return (
    <>
      {category && <input type="hidden" name="id" value={category.id} />}
      <FieldGroup legend={t("basics")} description={t("basicsHelp")}>
        <Field name="name" label={t("name")} htmlFor={`${key}-name`}>
          <Input
            id={`${key}-name`}
            name="name"
            required
            defaultValue={category?.name}
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
            defaultValue={category?.description}
            aria-describedby={`${key}-description-error`}
          />
        </Field>
        {!category && (
          <Field
            name="position"
            label={t("position")}
            htmlFor={`${key}-position`}
            help={t("positionHelp")}
          >
            <Input
              id={`${key}-position`}
              name="position"
              type="number"
              inputMode="numeric"
              aria-describedby={describedBy(`${key}-position`)}
              className="w-32"
            />
          </Field>
        )}
        <Field name="isActive" label={t("active")}>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={category ? category.isActive : true}
              className="size-5"
            />
            {t("activeHelp")}
          </label>
        </Field>
      </FieldGroup>
      <Advanced label={t("access")} fields={["rule"]}>
        <RuleField
          place="shopCategory"
          owner={category?.id}
          rule={category?.rule}
        />
      </Advanced>
    </>
  );
}
