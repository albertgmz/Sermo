import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EconomyFrame } from "../credits/shared";
import { GrantsScreen } from "./grants-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.grants");
  return { title: t("metaTitle") };
}

export default function AwardGrantsPage({
  searchParams,
}: PageProps<"/admin/award-grants">) {
  const t = useTranslations("adminEconomy.grants");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <GrantsScreen searchParams={searchParams} />
    </EconomyFrame>
  );
}
