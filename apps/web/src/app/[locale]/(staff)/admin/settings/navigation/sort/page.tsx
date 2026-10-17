import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../../skeletons";
import { navigationTrail } from "../navigation-trail";
import { SortLists } from "../sort-lists";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.navigation.sort");
  return { title: t("metaTitle") };
}

export default function SortEntriesPage() {
  const t = useTranslations("adminSetup.navigation.sort");
  const page = useTranslations("adminSetup.pages.navigation");
  return (
    <ScreenFrame
      trail={navigationTrail("/admin/settings/navigation/sort")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={page("loading")}
      fallback={<ListSkeleton rows={8} />}
    >
      <SortLists />
    </ScreenFrame>
  );
}
