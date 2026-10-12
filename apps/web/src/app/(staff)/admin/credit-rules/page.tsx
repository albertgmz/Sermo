import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EconomyFrame } from "../credits/shared";
import { RuleList } from "./rule-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.rules");
  return { title: t("metaTitle") };
}

export default function CreditRulesPage({
  searchParams,
}: PageProps<"/admin/credit-rules">) {
  const t = useTranslations("adminEconomy.rules");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <RuleList searchParams={searchParams} />
    </EconomyFrame>
  );
}
