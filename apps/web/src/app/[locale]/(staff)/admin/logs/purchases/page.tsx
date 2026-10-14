import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LogShell } from "../log-shell";
import { PurchaseLog } from "./purchase-log";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.purchases");
  return { title: t("metaTitle") };
}

export default function PurchasesPage({
  searchParams,
}: PageProps<"/[locale]/admin/logs/purchases">) {
  const t = useTranslations("adminTools.purchases");
  return (
    <LogShell
      heading={t("heading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <PurchaseLog searchParams={searchParams} />
    </LogShell>
  );
}
