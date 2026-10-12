import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AdjustScreen } from "./adjust-screen";
import { EconomyFrame } from "./shared";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.adjust");
  return { title: t("metaTitle") };
}

export default function CreditsPage({
  searchParams,
}: PageProps<"/admin/credits">) {
  const t = useTranslations("adminEconomy.adjust");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <AdjustScreen searchParams={searchParams} />
    </EconomyFrame>
  );
}
