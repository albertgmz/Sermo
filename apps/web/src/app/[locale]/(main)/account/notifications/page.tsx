import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { SearchParams } from "@/app/[locale]/(main)/account/notice";
import { TypesSection } from "@/app/[locale]/(main)/account/notifications/types-section";
import { SectionSkeleton } from "@/app/[locale]/(main)/account/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.notifications");
  return { title: t("metaTitle") };
}

export default function NotificationsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("account.notifications");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <TypesSkeleton />
          </LoadingRegion>
        }
      >
        <TypesSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

function TypesSkeleton() {
  const t = useTranslations("account.notifications");
  return (
    <SectionSkeleton
      heading={t("sectionHeading")}
      description={t("sectionDescription")}
      rows={8}
    />
  );
}
