import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageHeader } from "@/components/staff/page-header";
import { linkClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../../registry";
import { staffTrail } from "../../../trail";
import { getMember, staffRolesOf } from "../data";
import { MemberState } from "../member-state";
import { MemberTabs } from "./member-tabs";
import { TABS } from "./tabs";

export async function MemberHeader({
  params,
}: {
  params: PageProps<"/[locale]/admin/users/[id]">["params"];
}) {
  const userId = parseId((await params).id);
  if (userId === null) notFound();
  const [t, tabLabels, viewer, member, roles] = await Promise.all([
    getTranslations("adminUsers.header"),
    getTranslations("adminUsers.tabs"),
    getViewer(),
    getMember(userId),
    staffRolesOf(userId),
  ]);
  const tabs = TABS.flatMap((key) => {
    const href = hrefFor(viewer, key);
    return href
      ? [
          {
            value: key,
            label: tabLabels(key),
            href: href.replace("[id]", String(userId)),
          },
        ]
      : [];
  });
  const moderators = hrefFor(viewer, "staffModerators");
  const administrators = hrefFor(viewer, "staffAdministrators");
  const roleLink = (href: string | undefined, label: string) =>
    href ? (
      <Link href={href} className={linkClass}>
        {label}
      </Link>
    ) : (
      <span>{label}</span>
    );
  return (
    <>
      <div className="space-y-3">
        <PageHeader
          trail={staffTrail(`/admin/users/${userId}`)}
          title={
            <span className="flex items-center gap-3">
              <UserAvatar user={member.card} size="lg" link={false} />
              <UserLink
                user={member.card}
                className="inline-flex min-h-10 items-center"
              />
            </span>
          }
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <MemberState state={member.state} />
              {member.isSuperAdmin && <Badge>{t("superAdmin")}</Badge>}
              {roles.administrator &&
                roleLink(administrators, t("administrator"))}
              {roles.moderator && roleLink(moderators, t("moderator"))}
              <span className="[overflow-wrap:anywhere]">
                {t("id", { id: member.card.id })}
              </span>
            </span>
          }
        />
        {member.state === "erased" ? (
          <p
            role="note"
            className="rounded-lg border border-destructive/40 bg-card px-4 py-2.5 text-sm text-pretty"
          >
            {t("erased")}
          </p>
        ) : (
          !member.canEdit && (
            <p
              role="note"
              className="rounded-lg border bg-card px-4 py-2.5 text-sm text-pretty"
            >
              {t("readOnly")}
            </p>
          )
        )}
      </div>
      <MemberTabs tabs={tabs} label={t("tabs")} />
    </>
  );
}
