import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { NoticeList } from "./notice-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notices");
  return { title: t("metaTitle") };
}

export default function NoticesPage({
  searchParams,
}: PageProps<"/[locale]/admin/notices">) {
  const t = useTranslations("adminCommunication.notices");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <NoticeList searchParams={searchParams} />
    </ScreenFrame>
  );
}
