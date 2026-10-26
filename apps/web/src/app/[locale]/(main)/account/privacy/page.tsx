import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import type { SearchParams } from "@/app/[locale]/(main)/account/notice";
import {
  BlockedSection,
  PrivacySection,
} from "@/app/[locale]/(main)/account/privacy/sections";
import { PrivacySkeleton } from "@/app/[locale]/(main)/account/privacy/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.privacy");
  return { title: t("metaTitle") };
}

export default function PrivacyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("account.privacy");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <PrivacySkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <PrivacySection searchParams={searchParams} />
          <BlockedSection searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
