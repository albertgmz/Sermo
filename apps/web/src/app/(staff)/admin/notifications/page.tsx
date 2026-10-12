import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Notice } from "../content-kit/notice";
import { FormSkeleton, PageHead } from "../groups/skeletons";
import { DefaultsForm } from "./defaults-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notifications");
  return { title: t("metaTitle") };
}

async function Saved({
  searchParams,
}: {
  searchParams: PageProps<"/admin/notifications">["searchParams"];
}) {
  const t = await getTranslations("adminCommunication.notifications");
  return <Notice searchParams={searchParams} notices={{ saved: t("saved") }} />;
}

export default function NotificationsPage({
  searchParams,
}: PageProps<"/admin/notifications">) {
  const t = useTranslations("adminCommunication.notifications");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={8} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Saved searchParams={searchParams} />
          <DefaultsForm />
        </div>
      </Suspense>
    </div>
  );
}
