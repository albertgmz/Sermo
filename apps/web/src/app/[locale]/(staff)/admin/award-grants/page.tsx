import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { GrantsScreen } from "./grants-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.grants");
  return { title: t("metaTitle") };
}

export default function AwardGrantsPage({
  searchParams,
}: PageProps<"/[locale]/admin/award-grants">) {
  const t = useTranslations("adminEconomy.grants");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <GrantsScreen searchParams={searchParams} />
    </ScreenFrame>
  );
}
