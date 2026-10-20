import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { EditFormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { saveAwardCategory } from "../actions";
import { AwardCategoryFormFields } from "../category-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awardCategories.new");
  return { title: t("metaTitle") };
}

export default function NewAwardCategoryPage() {
  const t = useTranslations("adminEconomy.awardCategories");
  return (
    <ScreenFrame
      heading={t("new.heading")}
      subtitle={t("new.description")}
      trail={staffTrail("/admin/awards/categories/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton rows={2} />}
    >
      <EditForm action={saveAwardCategory} submit={t("new.submit")}>
        <AwardCategoryFormFields />
      </EditForm>
    </ScreenFrame>
  );
}
