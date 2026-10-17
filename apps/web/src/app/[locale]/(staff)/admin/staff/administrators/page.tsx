import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { AdministratorList } from "./administrator-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.administrators");
  return { title: t("metaTitle") };
}

export default function AdministratorsPage() {
  const t = useTranslations("adminGroups.administrators");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/staff/administrators")}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <AdministratorList />
    </ScreenFrame>
  );
}
