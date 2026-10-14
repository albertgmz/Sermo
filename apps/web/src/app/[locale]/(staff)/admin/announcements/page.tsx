import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../groups/skeletons";
import { AnnouncementList } from "./announcement-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.announcements");
  return { title: t("metaTitle") };
}

export default function AnnouncementsPage({
  searchParams,
}: PageProps<"/[locale]/admin/announcements">) {
  const t = useTranslations("adminCommunication.announcements");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={5} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <AnnouncementList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
