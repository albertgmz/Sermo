import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { PerksList } from "@/app/[locale]/(main)/account/permissions/perks";
import { PerksSkeleton } from "@/app/[locale]/(main)/account/permissions/skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.perks");
  return { title: t("metaTitle") };
}

export default function PerksPage() {
  const t = useTranslations("account.perks");
  return (
    <Suspense
      fallback={
        <LoadingRegion label={t("loading")}>
          <PerksSkeleton />
        </LoadingRegion>
      }
    >
      <PerksList />
    </Suspense>
  );
}
