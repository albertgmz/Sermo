import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { ModeratorList } from "./moderator-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.moderators");
  return { title: t("metaTitle") };
}

export default function ModeratorsPage() {
  const t = useTranslations("adminGroups.moderators");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/staff/moderators")}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <ModeratorList />
    </ScreenFrame>
  );
}
