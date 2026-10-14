import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LogShell } from "../log-shell";
import { PromotionLog } from "./promotion-log";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.promotionLog");
  return { title: t("metaTitle") };
}

export default function PromotionLogPage({
  searchParams,
}: PageProps<"/[locale]/admin/logs/promotions">) {
  const t = useTranslations("adminTools.promotionLog");
  return (
    <LogShell
      heading={t("heading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <PromotionLog searchParams={searchParams} />
    </LogShell>
  );
}
