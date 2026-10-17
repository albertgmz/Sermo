import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { Badge } from "@/components/ui/badge";
import { staffTrail } from "../../../trail";
import { getGroups } from "../../groups/data";
import { ListSkeleton } from "../../groups/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroups");
  return { title: t("metaTitle") };
}

async function Groups() {
  const [t, groups] = await Promise.all([
    getTranslations("adminGroups.permissionGroups"),
    getGroups(),
  ]);
  return (
    <ItemList
      label={t("heading")}
      heading={t("heading")}
      description={t("description")}
      filter
      empty={{ title: t("empty") }}
      items={groups.map((group) => {
        const href = `/admin/permissions/groups/${group.id}`;
        return {
          id: group.id,
          title: group.title,
          href,
          description: t("rank", { rank: group.rank }),
          badges: (
            <>
              {group.builtin && (
                <Badge variant="secondary">{t("builtin")}</Badge>
              )}
              {group.isStaff && <Badge variant="outline">{t("staff")}</Badge>}
            </>
          ),
          actions: (
            <RowLink
              href={href}
              label={t("editLabel", { group: group.title })}
              icon={<KeyRound />}
            />
          ),
        };
      })}
    />
  );
}

export default function PermissionGroupsPage() {
  const t = useTranslations("adminGroups.permissionGroups");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/permissions/groups")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <Groups />
    </ScreenFrame>
  );
}
