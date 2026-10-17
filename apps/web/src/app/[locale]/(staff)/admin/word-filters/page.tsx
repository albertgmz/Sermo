import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { getViewer } from "@/lib/sermo/session";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { FilterList } from "./filter-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters");
  return { title: t("metaTitle") };
}

// "Add filter", for a holder of wordFilter.manage; the others read the list.
async function NewFilterLink() {
  const [t, viewer] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
  ]);
  if (viewer.resolvedPermissions["wordFilter.manage"] !== true) return null;
  return <AddLink href="/admin/word-filters/new">{t("header.add")}</AddLink>;
}

export default function WordFiltersPage({
  searchParams,
}: PageProps<"/[locale]/admin/word-filters">) {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/word-filters")}
      actions={
        <Suspense fallback={null}>
          <NewFilterLink />
        </Suspense>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <FilterList searchParams={searchParams} />
    </ScreenFrame>
  );
}
