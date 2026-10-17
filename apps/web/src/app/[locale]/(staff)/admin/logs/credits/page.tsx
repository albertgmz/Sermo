import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LogShell } from "../log-shell";
import { CreditLedger } from "./credit-ledger";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.creditLedger");
  return { title: t("metaTitle") };
}

export default function CreditLedgerPage({
  searchParams,
}: PageProps<"/[locale]/admin/logs/credits">) {
  const t = useTranslations("adminTools.creditLedger");
  return (
    <LogShell
      path="/admin/logs/credits"
      heading={t("heading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <CreditLedger searchParams={searchParams} />
    </LogShell>
  );
}
