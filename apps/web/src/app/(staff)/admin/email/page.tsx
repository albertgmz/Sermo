import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Notice } from "@/components/staff/notice";
import { FormSkeleton, PageHead } from "../groups/skeletons";
import { EmailForm } from "./email-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.email");
  return { title: t("metaTitle") };
}

async function Saved({
  searchParams,
}: {
  searchParams: PageProps<"/admin/email">["searchParams"];
}) {
  const t = await getTranslations("adminCommunication.email");
  return <Notice searchParams={searchParams} notices={{ saved: t("saved") }} />;
}

export default function EmailPage({ searchParams }: PageProps<"/admin/email">) {
  const t = useTranslations("adminCommunication.email");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <FormSkeleton rows={4} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Saved searchParams={searchParams} />
          <EmailForm />
        </div>
      </Suspense>
    </div>
  );
}
