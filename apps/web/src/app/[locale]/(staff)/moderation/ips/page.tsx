import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageHead } from "../../admin/groups/skeletons";
import { ListSkeleton } from "../skeletons";
import { IpLookup } from "./ip-lookup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.ips");
  return { title: t("metaTitle") };
}

export default function IpsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/ips">) {
  const t = useTranslations("moderation.ips");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={4} />
          </LoadingRegion>
        }
      >
        <IpLookup searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
