import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { AdjustScreen } from "./adjust-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.adjust");
  return { title: t("metaTitle") };
}

export default function CreditsPage({
  searchParams,
}: PageProps<"/admin/credits">) {
  const t = useTranslations("adminEconomy.adjust");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <AdjustScreen searchParams={searchParams} />
    </ScreenFrame>
  );
}
