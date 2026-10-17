import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { AddLink } from "../credits/header-links";
import { ListSkeleton } from "../groups/skeletons";
import { RuleList } from "./rule-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.rules");
  return { title: t("metaTitle") };
}

export default function CreditRulesPage({
  searchParams,
}: PageProps<"/[locale]/admin/credit-rules">) {
  const t = useTranslations("adminEconomy.rules");
  const add = <AddLink href="/admin/credit-rules/new">{t("add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/credit-rules")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <RuleList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
