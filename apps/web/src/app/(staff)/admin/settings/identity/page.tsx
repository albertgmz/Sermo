import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, PageHead } from "../../groups/skeletons";
import { SettingsNotice } from "../settings-screen";
import { IdentityForm } from "./identity-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.identity");
  return { title: t("metaTitle") };
}

export default function IdentityPage({
  searchParams,
}: PageProps<"/admin/settings/identity">) {
  const t = useTranslations("adminSetup.identity");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={3} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <SettingsNotice searchParams={searchParams} />
          <IdentityForm />
        </div>
      </Suspense>
    </div>
  );
}
