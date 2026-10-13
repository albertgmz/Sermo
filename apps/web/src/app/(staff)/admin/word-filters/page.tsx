import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { FilterList } from "./filter-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters");
  return { title: t("metaTitle") };
}

export default function WordFiltersPage({
  searchParams,
}: PageProps<"/admin/word-filters">) {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <FilterList searchParams={searchParams} />
    </ScreenFrame>
  );
}
