import { shopCategoriesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm } from "@/components/staff/edit-form";
import { PageHeader } from "@/components/staff/page-header";
import { StreamedPanel } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { staffTrail } from "../../../../trail";
import { EditFormSkeleton } from "../../../credits/skeletons";
import { deleteCategory, saveCategory } from "../actions";
import { CategoryFormFields } from "../category-form";

type Params = PageProps<"/[locale]/admin/shop/categories/[id]">["params"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories.editPage");
  return { title: t("metaTitle") };
}

// The category by its id among all of them (the backend reads them only as a list). Its name is
// the page's heading, so the header is drawn once the category is read.
async function EditCategory({ params }: { params: Params }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [t, { items }] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    read(shopCategoriesList, {}),
  ]);
  const category = items.find((item) => item.id === id);
  if (!category) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail(`/admin/shop/categories/${category.id}`)}
        title={category.name}
        description={t("editPage.description")}
      />
      <div className="space-y-4">
        <EditForm action={saveCategory}>
          <CategoryFormFields category={category} />
        </EditForm>
        <ConfirmStep
          action={deleteCategory}
          fields={{ id: category.id }}
          heading={t("deleteHeading")}
          warning={t("deleteWarning")}
          submit={t("delete")}
        />
      </div>
    </div>
  );
}

export default function EditCategoryPage({
  params,
}: PageProps<"/[locale]/admin/shop/categories/[id]">) {
  const t = useTranslations("adminEconomy.categories");
  return (
    <StreamedPanel
      label={t("loading")}
      fallback={<EditFormSkeleton heading rows={3} advanced />}
    >
      <EditCategory params={params} />
    </StreamedPanel>
  );
}
