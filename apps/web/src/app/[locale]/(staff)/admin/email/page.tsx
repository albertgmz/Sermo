import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { EmailForm } from "./email-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.email");
  return { title: t("metaTitle") };
}

async function Saved({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/email">["searchParams"];
}) {
  const t = await getTranslations("adminCommunication.email");
  return <Notice searchParams={searchParams} notices={{ saved: t("saved") }} />;
}

export default function EmailPage({
  searchParams,
}: PageProps<"/[locale]/admin/email">) {
  const t = useTranslations("adminCommunication.email");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/email")}
      label={t("loading")}
      fallback={<FormSkeleton rows={4} />}
    >
      <Saved searchParams={searchParams} />
      <EmailForm />
    </ScreenFrame>
  );
}
