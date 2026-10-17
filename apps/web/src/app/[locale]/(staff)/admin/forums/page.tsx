import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink, HeaderLink, SortLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { ForumTree } from "./tree";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.tree");
  return { title: t("metaTitle") };
}

export default function ForumsPage({
  searchParams,
}: PageProps<"/[locale]/admin/forums">) {
  const t = useTranslations("adminForums.tree");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/forums")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      actions={
        <>
          <SortLink href="/admin/forums/sort">{t("sort")}</SortLink>
          <HeaderLink
            href="/admin/forums/new/category"
            icon={<Plus aria-hidden="true" />}
          >
            {t("addCategory")}
          </HeaderLink>
          <AddLink href="/admin/forums/new/forum">{t("addForum")}</AddLink>
        </>
      }
      label={t("loading")}
      fallback={
        <div className="space-y-4">
          <ListSkeleton rows={6} />
          <ListSkeleton rows={2} />
        </div>
      }
    >
      <ForumTree searchParams={searchParams} />
    </ScreenFrame>
  );
}
