import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AppearanceGroup } from "@/app/[locale]/(main)/account/appearance-group";
import { AccountLinks } from "@/app/[locale]/(main)/account/navigation";
import type { SearchParams } from "@/app/[locale]/(main)/account/notice";
import { ProfileGroup } from "@/app/[locale]/(main)/account/profile-forms";
import { ProfileSkeleton } from "@/app/[locale]/(main)/account/profile-skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ScrollToHash } from "@/components/layout/scroll-to-hash";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.profile");
  return { title: t("metaTitle") };
}

export default function AccountPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("account.profile");
  return (
    <div className="space-y-4">
      <ScrollToHash />
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ProfileSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <ProfileGroup searchParams={searchParams} />
          <AppearanceGroup />
          <AccountLinks />
        </div>
      </Suspense>
    </div>
  );
}
