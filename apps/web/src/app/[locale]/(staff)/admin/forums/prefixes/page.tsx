import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../../groups/skeletons";
import { PrefixList } from "./prefix-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixes");
  return { title: t("metaTitle") };
}

export default function PrefixesPage({
  searchParams,
}: PageProps<"/[locale]/admin/forums/prefixes">) {
  const t = useTranslations("adminForums.prefixes");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <PrefixList searchParams={searchParams} />
    </ScreenFrame>
  );
}
