import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { SortGroups } from "./sort-groups";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.sort");
  return { title: t("metaTitle") };
}

export default function ForumsSortPage() {
  const t = useTranslations("adminForums.sort");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/forums/sort")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={
        <div className="space-y-4">
          <ListSkeleton rows={4} />
        </div>
      }
    >
      <SortGroups />
    </ScreenFrame>
  );
}
