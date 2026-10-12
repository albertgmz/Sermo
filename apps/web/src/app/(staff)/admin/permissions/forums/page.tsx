import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../../groups/skeletons";
import { ForumPermissions } from "./forum-permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionForums");
  return { title: t("metaTitle") };
}

export default function PermissionForumsPage({
  searchParams,
}: PageProps<"/admin/permissions/forums">) {
  const t = useTranslations("adminGroups.permissionForums");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={3} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <ForumPermissions searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
