import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { PageList } from "./page-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pages");
  return { title: t("metaTitle") };
}

export default function PagesPage({
  searchParams,
}: PageProps<"/[locale]/admin/pages">) {
  const t = useTranslations("adminContent.pages");
  const add = <AddLink href="/admin/pages/-new">{t("header.add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/pages")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <PageList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
