import { staffModerators } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { StaffList } from "../staff-list";

// Who moderates what: each member holding a moderation permission, everywhere or in the listed
// forums, with links to their permissions and to the permissions of each forum.
export async function ModeratorList() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminGroups.moderators"),
    read(staffModerators, {}),
  ]);
  return (
    <StaffList
      items={items}
      heading={t("heading")}
      permissions={(name) => t("permissions", { name })}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      detail={(item) => (
        <div className="flex flex-wrap items-center gap-2 pb-2">
          {item.everywhere && (
            <Badge variant="success">{t("everywhere")}</Badge>
          )}
          {item.nodes.map((node) => (
            <Link
              key={node.id}
              href={`/admin/permissions/forums?node=${node.id}`}
              className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm [overflow-wrap:anywhere] hover:bg-muted"
            >
              {node.title}
            </Link>
          ))}
        </div>
      )}
    />
  );
}
