import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ApiIntro, KeyWarning } from "@/app/[locale]/(main)/account/api/intro";
import { KeySection } from "@/app/[locale]/(main)/account/api/keys";
import { KeySkeleton } from "@/app/[locale]/(main)/account/api/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Notice } from "@/components/staff/notice";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.apiKeys");
  return { title: t("metaTitle") };
}

export default function ApiPage({
  searchParams,
}: PageProps<"/[locale]/account/api">) {
  const t = useTranslations("account.apiKeys");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Notice
        searchParams={searchParams}
        notices={{ revoked: t("notices.revoked") }}
      />
      <ApiIntro />
      <KeyWarning />
      <Suspense
        fallback={
          <LoadingRegion label={t("key.loading")}>
            <KeySkeleton />
          </LoadingRegion>
        }
      >
        <KeySection />
      </Suspense>
    </div>
  );
}
