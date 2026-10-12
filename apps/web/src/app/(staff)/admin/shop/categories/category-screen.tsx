import { shopCategoriesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { getLadder } from "@/app/(main)/upgrade/ladder";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { EconomyNotice, one } from "../../credits/shared";
import { ConfirmDelete } from "../../groups/confirm-delete";
import { deleteCategory, saveCategory, saveCategoryOrder } from "./actions";

type Category = z.output<typeof shopCategoriesList.output>["items"][number];

// The form of a category, new (no `category`) or a change.
async function CategoryForm({ category }: { category?: Category }) {
  const t = await getTranslations("adminEconomy.categories.form");
  const key = `category-${category?.id ?? "new"}`;
  return (
    <FormRows
      action={saveCategory}
      id={category ? undefined : "new"}
      heading={category ? t("headingEdit") : t("headingNew")}
      description={category ? undefined : t("descriptionNew")}
      submit={category ? undefined : t("create")}
    >
      {category && <input type="hidden" name="id" value={category.id} />}
      <FieldRow name="name" label={t("name")} htmlFor={`${key}-name`}>
        <Input
          id={`${key}-name`}
          name="name"
          required
          defaultValue={category?.name}
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
          defaultValue={category?.description}
        />
      </FieldRow>
      {!category && (
        <FieldRow
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
          />
        </FieldRow>
      )}
      <FieldRow name="isActive" label={t("active")}>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={category ? category.isActive : true}
            className="size-5"
          />
          {t("activeHelp")}
        </label>
      </FieldRow>
    </FormRows>
  );
}

// Which category the public upgrade page takes its ranks from, by the site convention the page
// itself uses (`getLadder`).
async function LadderNote() {
  const [t, ladder] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    getLadder(),
  ]);
  return (
    <p className="rounded-lg border bg-card px-4 py-2.5 text-sm text-pretty">
      {ladder
        ? t("ladder", {
            name: ladder.category.name,
            count: ladder.ranks.length,
          })
        : t("noLadder")}{" "}
      <span className="text-muted-foreground">{t("ladderRule")}</span>
    </p>
  );
}

// The categories in display order with a number each ("Save order" saves the numbers changed),
// the editor of one behind its "Edit", then the form for a new category.
export async function CategoryScreen({
  searchParams,
}: {
  searchParams: PageProps<"/admin/shop/categories">["searchParams"];
}) {
  const [t, { items }, params] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    read(shopCategoriesList, {}),
    searchParams,
  ]);
  const editing = parseId(one(params.edit));
  const editingCategory = items.find((category) => category.id === editing);
  return (
    <>
      <EconomyNotice
        searchParams={searchParams}
        shown={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          ordered: t("notices.ordered"),
          deleted: t("notices.deleted"),
        }}
      />
      <LadderNote />
      {items.length > 0 ? (
        <FormRows
          action={saveCategoryOrder}
          heading={t("heading")}
          description={t("orderHelp")}
          submit={t("saveOrder")}
        >
          {items.map((category) => (
            <FieldRow
              key={category.id}
              name={`position:${category.id}`}
              label={
                <span className="[overflow-wrap:anywhere]">
                  {category.name}
                </span>
              }
              htmlFor={`position-${category.id}`}
            >
              <div className="flex flex-wrap items-center gap-3">
                <input
                  type="hidden"
                  name={`before:${category.id}`}
                  value={category.position}
                />
                <Input
                  id={`position-${category.id}`}
                  name={`position:${category.id}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  defaultValue={category.position}
                  className="w-28"
                />
                {category.isActive ? (
                  <Badge variant="success">{t("active")}</Badge>
                ) : (
                  <Badge variant="outline">{t("inactive")}</Badge>
                )}
                <Link
                  href={
                    editing === category.id
                      ? "/admin/shop/categories"
                      : `/admin/shop/categories?edit=${category.id}#edit`
                  }
                  scroll={false}
                  className="inline-flex min-h-10 min-w-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {editing === category.id ? t("close") : t("edit")}
                </Link>
                <Link
                  href={`/admin/shop/items?category=${category.id}`}
                  className="inline-flex min-h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("items")}
                </Link>
              </div>
              {category.description && (
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  {category.description}
                </p>
              )}
            </FieldRow>
          ))}
        </FormRows>
      ) : (
        <Section heading={t("heading")}>
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        </Section>
      )}
      {editingCategory && (
        <div id="edit" className="scroll-mt-4 space-y-4">
          <CategoryForm category={editingCategory} />
          <ConfirmDelete
            action={deleteCategory}
            id={editingCategory.id}
            summary={t("deleteHeading")}
            warning={t("deleteWarning")}
            submit={t("delete")}
          />
        </div>
      )}
      <CategoryForm />
    </>
  );
}
