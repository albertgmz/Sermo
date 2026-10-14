import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { SearchParams } from "@/app/[locale]/(main)/account/notice";
import {
  ForumWatches,
  PreferencesSection,
  ThreadWatches,
} from "@/app/[locale]/(main)/account/preferences/sections";
import { PreferencesSkeleton } from "@/app/[locale]/(main)/account/preferences/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.preferences");
  return { title: t("metaTitle") };
}

export default function PreferencesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("account.preferences");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <PreferencesSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <PreferencesSection searchParams={searchParams} />
          <ThreadWatches searchParams={searchParams} />
          <ForumWatches searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
