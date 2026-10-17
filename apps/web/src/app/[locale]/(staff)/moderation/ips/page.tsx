import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { IpLookup } from "./ip-lookup";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.ips");
  return { title: t("metaTitle") };
}

export default function IpsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/ips">) {
  const t = useTranslations("moderation.ips");
  return (
    <ScreenFrame
      trail={staffTrail("/moderation/ips")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton rows={4} />}
    >
      <IpLookup searchParams={searchParams} />
    </ScreenFrame>
  );
}
