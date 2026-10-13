import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { PageList } from "./page-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pages");
  return { title: t("metaTitle") };
}

export default function PagesPage({ searchParams }: PageProps<"/admin/pages">) {
  const t = useTranslations("adminContent.pages");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <PageList searchParams={searchParams} />
    </ScreenFrame>
  );
}
