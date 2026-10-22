import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { WidgetList } from "./widget-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminWidgets.pages.list");
  return { title: t("metaTitle") };
}

export default function WidgetsPage({
  searchParams,
}: PageProps<"/[locale]/admin/widgets">) {
  const t = useTranslations("adminWidgets.pages");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/widgets")}
      heading={t("list.heading")}
      subtitle={t("list.subtitle")}
      actions={<AddLink href="/admin/widgets/new">{t("add")}</AddLink>}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <WidgetList searchParams={searchParams} />
    </ScreenFrame>
  );
}
