import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EconomyFrame } from "../credits/shared";
import { AwardList } from "./award-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awards");
  return { title: t("metaTitle") };
}

export default function AwardsPage({
  searchParams,
}: PageProps<"/admin/awards">) {
  const t = useTranslations("adminEconomy.awards");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <AwardList searchParams={searchParams} />
    </EconomyFrame>
  );
}
