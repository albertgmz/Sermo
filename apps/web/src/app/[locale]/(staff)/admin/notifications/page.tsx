import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { FormSkeleton } from "../groups/skeletons";
import { DefaultsForm } from "./defaults-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notifications");
  return { title: t("metaTitle") };
}

async function Saved({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/notifications">["searchParams"];
}) {
  const t = await getTranslations("adminCommunication.notifications");
  return <Notice searchParams={searchParams} notices={{ saved: t("saved") }} />;
}

export default function NotificationsPage({
  searchParams,
}: PageProps<"/[locale]/admin/notifications">) {
  const t = useTranslations("adminCommunication.notifications");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/notifications")}
      label={t("loading")}
      fallback={<FormSkeleton rows={8} />}
    >
      <Saved searchParams={searchParams} />
      <DefaultsForm />
    </ScreenFrame>
  );
}
