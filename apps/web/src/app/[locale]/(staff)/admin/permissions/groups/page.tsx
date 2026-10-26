import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { getGroups } from "../../groups/data";
import { permissionOf } from "../data";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroups");
  return { title: t("metaTitle") };
}

async function Groups({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/permissions/groups">["searchParams"];
}) {
  const [t, groups, params] = await Promise.all([
    getTranslations("adminGroups.permissionGroups"),
    getGroups(),
    searchParams,
  ]);
  const permission = permissionOf(params);
  const query = permission
    ? `?${new URLSearchParams({ permission }).toString()}`
    : "";
  return (
    <ItemList
      label={t("heading")}
      heading={t("heading")}
      description={t("description")}
      empty={{ title: t("empty") }}
      items={groups.map((group) => {
        const href = `/admin/permissions/groups/${group.id}${query}`;
        return {
          id: group.id,
          title: group.title,
          href,
          description: t("rank", { rank: group.rank }),
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

export default function PermissionGroupsPage({
  searchParams,
}: PageProps<"/[locale]/admin/permissions/groups">) {
  const t = useTranslations("adminGroups.permissionGroups");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/permissions/groups")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <Groups searchParams={searchParams} />
    </ScreenFrame>
  );
}
