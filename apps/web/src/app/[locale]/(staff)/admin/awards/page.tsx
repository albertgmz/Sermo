import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { AwardList } from "./award-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awards");
  return { title: t("metaTitle") };
}

export default function AwardsPage({
  searchParams,
}: PageProps<"/[locale]/admin/awards">) {
  const t = useTranslations("adminEconomy.awards");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <AwardList searchParams={searchParams} />
    </ScreenFrame>
  );
}
