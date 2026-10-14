import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../groups/skeletons";
import { ReactionList } from "./reaction-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions");
  return { title: t("metaTitle") };
}

export default function ReactionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/reactions">) {
  const t = useTranslations("adminContent.reactions");
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <ReactionList searchParams={searchParams} />
    </ScreenFrame>
  );
}
