import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { PrefixList } from "./prefix-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixes");
  return { title: t("metaTitle") };
}

export default function PrefixesPage({
  searchParams,
}: PageProps<"/[locale]/admin/forums/prefixes">) {
  const t = useTranslations("adminForums.prefixes");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/forums/prefixes")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      actions={<AddLink href="/admin/forums/prefixes/new">{t("add")}</AddLink>}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PrefixList searchParams={searchParams} />
    </ScreenFrame>
  );
}
