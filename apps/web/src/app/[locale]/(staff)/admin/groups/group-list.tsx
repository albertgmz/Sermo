import { groupsList, paletteColorsList } from "@sermo/core/contracts";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { isHexColor } from "@/lib/css-color";
import { paletteName } from "@/lib/palette-name";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../registry";
import { inLanguage } from "./data";

// Every group in the order the backend returns them, each leading to its edit page.
export async function GroupList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, names, viewer, { items: stored }, { items: colours }] =
    await Promise.all([
      getTranslations("adminGroups.list"),
      getTranslations("lib.appearance"),
      getViewer(),
      read(groupsList, { counts: true }),
      read(paletteColorsList, { kind: "name" }),
    ]);
  const items = await inLanguage(stored);
  const colourOf = new Map(colours.map((colour) => [colour.id, colour]));
  const permissions = hrefFor(viewer, "permissionsGroups");
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["deleted"]}
      />
      <ItemList
        label={t("heading")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
        items={items.map((group) => {
          const colour = group.nameColorId
            ? colourOf.get(group.nameColorId)
            : undefined;
          return {
            id: group.id,
            title: (
              <span
                style={
                  colour && isHexColor(colour.color)
                    ? { color: colour.color }
                    : undefined
                }
              >
                {group.title}
              </span>
            ),
            href: `/admin/groups/${group.id}`,
            badges: (
              <>
                {group.builtin && (
                  <Badge variant="secondary">{t("builtin")}</Badge>
                )}
                {group.isStaff && <Badge variant="success">{t("staff")}</Badge>}
              </>
            ),
            description: (
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                <div className="flex gap-1">
                  <dt>{t("rank")}</dt>
                  <dd className="font-medium text-foreground">{group.rank}</dd>
                </div>
                {group.memberCount !== null && (
                  <div className="flex gap-1">
                    <dt>{t("members")}</dt>
                    <dd className="font-medium text-foreground">
                      {group.memberCount}
                    </dd>
                  </div>
                )}
                <div className="flex gap-1">
                  <dt>{t("nameColour")}</dt>
                  <dd className="flex items-center gap-1 font-medium text-foreground">
                    {colour ? (
                      <>
                        <span
                          aria-hidden="true"
                          className="size-3 rounded-full border"
                          style={
                            isHexColor(colour.color)
                              ? { backgroundColor: colour.color }
                              : undefined
                          }
                        />
                        {paletteName(names, "nameColors", colour.name)}
                      </>
                    ) : group.nameColorId ? (
                      t("colourHidden")
                    ) : (
                      t("none")
                    )}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt>{t("badge")}</dt>
                  <dd className="font-medium text-foreground">
                    {group.badge || t("none")}
                  </dd>
                </div>
                {group.userTitle && (
                  <div className="flex gap-1">
                    <dt>{t("userTitle")}</dt>
                    <dd className="font-medium text-foreground">
                      {group.userTitle}
                    </dd>
                  </div>
                )}
              </dl>
            ),
            actions: (
              <>
                <RowLink
                  href={`/admin/groups/${group.id}`}
                  label={t("edit", { title: group.title })}
                />
                {permissions && (
                  <RowLink
                    href={`${permissions}/${group.id}`}
                    label={t("permissions", { title: group.title })}
                    icon={<ShieldCheck />}
                  />
                )}
              </>
            ),
          };
        })}
      />
    </>
  );
}
