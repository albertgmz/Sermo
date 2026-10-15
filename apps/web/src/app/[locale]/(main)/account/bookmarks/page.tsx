import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { BookmarkList } from "@/app/[locale]/(main)/account/bookmarks/bookmark-list";
import { SectionSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.bookmarks");
  return { title: t("metaTitle") };
}

export default function BookmarksPage({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    pages?: string | string[];
  }>;
}) {
  const t = useTranslations("account.bookmarks");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <SectionSkeleton heading={t("sectionHeading")} rows={4} />
          </LoadingRegion>
        }
      >
        <BookmarkList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
