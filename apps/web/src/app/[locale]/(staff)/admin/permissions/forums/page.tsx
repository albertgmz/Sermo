import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { ForumPermissions } from "./forum-permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionForums");
  return { title: t("metaTitle") };
}

export default function PermissionForumsPage({
  searchParams,
}: PageProps<"/[locale]/admin/permissions/forums">) {
  const t = useTranslations("adminGroups.permissionForums");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/permissions/forums")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton rows={3} />}
    >
      <ForumPermissions searchParams={searchParams} />
    </ScreenFrame>
  );
}
