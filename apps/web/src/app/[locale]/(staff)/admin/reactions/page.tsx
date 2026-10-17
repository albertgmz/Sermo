import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink, SortLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { ReactionList } from "./reaction-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions");
  return { title: t("metaTitle") };
}

export default function ReactionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/reactions">) {
  const t = useTranslations("adminContent.reactions");
  const add = <AddLink href="/admin/reactions/new">{t("header.add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/reactions")}
      actions={
        <>
          <SortLink href="/admin/reactions/sort">{t("header.sort")}</SortLink>
          {add}
        </>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <ReactionList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
