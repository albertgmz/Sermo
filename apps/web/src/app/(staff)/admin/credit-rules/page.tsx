import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
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
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <RuleList searchParams={searchParams} />
    </ScreenFrame>
  );
}
