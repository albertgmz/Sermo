import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AppearancePanel } from "@/app/[locale]/(main)/account/appearance/panel";
import { AppearanceSkeleton } from "@/app/[locale]/(main)/account/appearance/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.appearance");
  return { title: t("metaTitle") };
}

export default function AppearancePage({
  searchParams,
}: PageProps<"/[locale]/account/appearance">) {
  const t = useTranslations("account.appearance");
  return (
    <Suspense
      fallback={
        <LoadingRegion label={t("loading")}>
          <AppearanceSkeleton />
        </LoadingRegion>
      }
    >
      <AppearancePanel searchParams={searchParams} />
    </Suspense>
  );
}
