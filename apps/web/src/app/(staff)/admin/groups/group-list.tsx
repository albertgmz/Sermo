import { groupsList, paletteColorsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../registry";
import { GroupForm } from "./group-form";
import { Notice } from "./notice";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// Every group in the order the backend returns them, then the form for a new one.
export async function GroupList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, viewer, { items }, { items: colours }] = await Promise.all([
    getTranslations("adminGroups.list"),
    getViewer(),
    read(groupsList, {}),
    read(paletteColorsList, { kind: "name" }),
  ]);
  const colourOf = new Map(colours.map((colour) => [colour.id, colour]));
  const permissions = hrefFor(viewer, "permissionsGroups");
  return (
    <>
      <Notice searchParams={searchParams} shown={["deleted"]} />
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
          <a href="#new" className={link}>
            {t("new")}
          </a>
        </div>
        <ul aria-label={t("heading")} className="divide-y">
          {items.map((group) => {
            const colour = group.nameColorId
              ? colourOf.get(group.nameColorId)
              : undefined;
            return (
              <li
                key={group.id}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-sm font-semibold [overflow-wrap:anywhere]"
                      style={colour ? { color: colour.color } : undefined}
                    >
                      {group.title}
                    </span>
                    {group.builtin && (
                      <Badge variant="secondary">{t("builtin")}</Badge>
                    )}
                    {group.isStaff && (
                      <Badge variant="success">{t("staff")}</Badge>
                    )}
                  </p>
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>{t("rank")}</dt>
                      <dd className="font-medium text-foreground">
                        {group.rank}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>{t("members")}</dt>
                      <dd className="font-medium text-foreground">
                        {group.memberCount}
                      </dd>
                    </div>
                    <div className="flex gap-1">
                      <dt>{t("nameColour")}</dt>
                      <dd className="flex items-center gap-1 font-medium text-foreground">
                        {colour ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="size-3 rounded-full border"
                              style={{ backgroundColor: colour.color }}
                            />
                            {colour.name}
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
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/admin/groups/${group.id}`} className={link}>
                    {t("edit")}
                  </Link>
                  {permissions && (
                    <Link href={`${permissions}/${group.id}`} className={link}>
                      {t("permissions")}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <GroupForm />
    </>
  );
}
