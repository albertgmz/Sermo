import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { staffTrail } from "../../trail";
import { GroupList } from "./group-list";
import { NewGroup } from "./new-group";
import { ListSkeleton } from "./skeletons";

export async function generateMetadata({
  searchParams,
}: PageProps<"/[locale]/admin/groups">): Promise<Metadata> {
  const creating = (await searchParams).new !== undefined;
  const t = await getTranslations(
    creating ? "adminGroups.new" : "adminGroups.list",
  );
  return { title: t("metaTitle") };
}

export default async function GroupsPage({
  searchParams,
}: PageProps<"/[locale]/admin/groups">) {
  if ((await searchParams).new !== undefined) return <NewGroup />;
  const t = await getTranslations("adminGroups.list");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/groups")}
      actions={
        <Link
          href="/admin/groups?new=1"
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
