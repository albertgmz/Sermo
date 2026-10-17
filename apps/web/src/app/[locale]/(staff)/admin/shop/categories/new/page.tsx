import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../../trail";
import { EditFormSkeleton } from "../../../credits/skeletons";
import { saveCategory } from "../actions";
import { CategoryFormFields } from "../category-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories.new");
  return { title: t("metaTitle") };
}

export default function NewCategoryPage() {
  const t = useTranslations("adminEconomy.categories");
  return (
    <ScreenFrame
      heading={t("new.heading")}
      subtitle={t("new.description")}
      trail={staffTrail("/admin/shop/categories/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton rows={4} advanced />}
    >
      <EditForm action={saveCategory} submit={t("new.submit")}>
        <CategoryFormFields />
      </EditForm>
    </ScreenFrame>
  );
}
