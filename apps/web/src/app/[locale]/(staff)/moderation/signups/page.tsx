import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageHead } from "../../admin/groups/skeletons";
import { SignupsSkeleton } from "../skeletons";
import { DecisionResult } from "./decision-result";
import { SignupList } from "./signup-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.signups");
  return { title: t("metaTitle") };
}

export default function SignupsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/signups">) {
  const t = useTranslations("moderation.signups");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <SignupsSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <DecisionResult searchParams={searchParams} />
          <SignupList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
