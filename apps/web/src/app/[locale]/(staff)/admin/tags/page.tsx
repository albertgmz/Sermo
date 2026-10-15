import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { TagList } from "./tag-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.tags");
  return { title: t("metaTitle") };
}

export default function TagsPage({
  searchParams,
}: PageProps<"/[locale]/admin/tags">) {
  const t = useTranslations("adminContent.tags");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <TagList searchParams={searchParams} />
    </ScreenFrame>
  );
}
