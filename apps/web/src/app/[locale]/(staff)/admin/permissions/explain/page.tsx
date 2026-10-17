import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { Explain } from "./explain";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.explain");
  return { title: t("metaTitle") };
}

export default function ExplainPage({
  searchParams,
}: PageProps<"/[locale]/admin/permissions/explain">) {
  const t = useTranslations("adminGroups.explain");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/permissions/explain")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton rows={3} />}
    >
      <Explain searchParams={searchParams} />
    </ScreenFrame>
  );
}
