import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { FilterList } from "./filter-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters");
  return { title: t("metaTitle") };
}

// "New filter", for a holder of wordFilter.manage; the others read the list.
async function NewFilterLink() {
  const [t, viewer] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
  ]);
  if (viewer.resolvedPermissions["wordFilter.manage"] !== true) return null;
  return (
    <Link
      href="/admin/word-filters/new"
      className={cn(buttonVariants(), "h-10 px-4 md:h-8 md:px-3")}
    >
      <Plus aria-hidden="true" />
      {t("header.add")}
    </Link>
  );
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
