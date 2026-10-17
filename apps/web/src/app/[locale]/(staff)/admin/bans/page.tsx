import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { BanList } from "./ban-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.bans");
  return { title: t("metaTitle") };
}

export default function BansPage({
  searchParams,
}: PageProps<"/[locale]/admin/bans">) {
  const t = useTranslations("adminUsers.bans");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/bans")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <BanList searchParams={searchParams} />
    </ScreenFrame>
  );
}
