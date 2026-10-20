import { awardCategoriesList } from "@sermo/core/contracts";
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
import { EditFormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { deleteAwardCategory, saveAwardCategory } from "../actions";
import { AwardCategoryFormFields } from "../category-form";

type Params = PageProps<"/[locale]/admin/awards/categories/[id]">["params"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awardCategories.editPage");
  return { title: t("metaTitle") };
}

// The category by its id among all of them (the backend reads them only as a list). Its title is
// the page's heading, so the header is drawn once the category is read.
async function EditAwardCategory({ params }: { params: Params }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [t, { items }] = await Promise.all([
    getTranslations("adminEconomy.awardCategories"),
    read(awardCategoriesList, {}),
  ]);
  const category = items.find((item) => item.id === id);
  if (!category) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail(`/admin/awards/categories/${category.id}`)}
        title={category.title}
        description={t("count", { count: category.awardCount })}
      />
      <div className="space-y-4">
        <EditForm action={saveAwardCategory}>
          <AwardCategoryFormFields category={category} />
        </EditForm>
        <ConfirmStep
          action={deleteAwardCategory}
          fields={{ id: category.id }}
          heading={t("deleteHeading")}
          warning={t("deleteWarning", { count: category.awardCount })}
          submit={t("delete")}
        />
      </div>
    </div>
  );
}

export default function EditAwardCategoryPage({
  params,
}: PageProps<"/[locale]/admin/awards/categories/[id]">) {
  const t = useTranslations("adminEconomy.awardCategories");
  return (
    <StreamedPanel
      label={t("loading")}
      fallback={<EditFormSkeleton heading rows={2} />}
    >
      <EditAwardCategory params={params} />
    </StreamedPanel>
  );
}
