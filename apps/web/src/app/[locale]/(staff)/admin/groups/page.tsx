import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { staffTrail } from "../../trail";
import { GroupList } from "./group-list";
import { ListSkeleton } from "./skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.list");
  return { title: t("metaTitle") };
}

export default function GroupsPage({
  searchParams,
}: PageProps<"/[locale]/admin/groups">) {
  const t = useTranslations("adminGroups.list");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/groups")}
      actions={
        <Link
          href="/admin/groups/new"
          className={buttonVariants({ className: "min-h-10 px-4" })}
        >
          <Plus aria-hidden="true" />
          {t("new")}
        </Link>
      }
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <GroupList searchParams={searchParams} />
    </ScreenFrame>
  );
}
