import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { asPosition } from "../positions";
import { SortLists } from "../sort-lists";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminWidgets.pages.sort");
  return { title: t("metaTitle") };
}

async function Lists({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/widgets/sort">["searchParams"];
}) {
  const { position } = await searchParams;
  return (
    <SortLists
      position={
        (typeof position === "string" ? asPosition(position) : null) ??
        undefined
      }
    />
  );
}

export default function SortWidgetsPage({
  searchParams,
}: PageProps<"/[locale]/admin/widgets/sort">) {
  const t = useTranslations("adminWidgets.pages");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/widgets/sort")}
      heading={t("sort.heading")}
      subtitle={t("sort.subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <Lists searchParams={searchParams} />
    </ScreenFrame>
  );
}
