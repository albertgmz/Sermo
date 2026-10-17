import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { ForumTree } from "./tree";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.tree");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

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
          <Link href="/admin/forums/sort" className={link}>
            {t("sort")}
          </Link>
          <Link href="/admin/forums/new/category" className={link}>
            {t("addCategory")}
          </Link>
          <Link
            href="/admin/forums/new/forum"
            className={cn(buttonVariants(), "min-h-10 px-4")}
          >
            {t("addForum")}
          </Link>
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
