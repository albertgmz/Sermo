import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { linkClass } from "@/components/staff/rows";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor, type ScreenKey } from "../../../registry";
import { getMember, staffRolesOf } from "../data";
import { MemberState } from "../member-state";
import { MemberTabs } from "./member-tabs";

// The tabs in their order, each a screen of the registry.
export const TABS = [
  "usersEdit",
  "usersGroups",
  "usersProfile",
  "usersAppearance",
  "usersPermissions",
  "usersSanctions",
  "usersEconomy",
  "usersSessions",
  "usersHistory",
] as const satisfies readonly ScreenKey[];

export async function MemberHeader({
  params,
}: {
  params: PageProps<"/admin/users/[id]">["params"];
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
      <header className="space-y-3">
        <div className="flex items-center gap-4">
          <UserAvatar user={member.card} size="xl" link={false} />
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-bold tracking-tight [overflow-wrap:anywhere]">
              <UserLink user={member.card} />
            </h1>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <MemberState state={member.state} />
              {roles.administrator &&
                roleLink(administrators, t("administrator"))}
              {roles.moderator && roleLink(moderators, t("moderator"))}
              <span className="[overflow-wrap:anywhere]">
                {t("id", { id: member.card.id })}
              </span>
            </p>
          </div>
        </div>
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
      </header>
      <MemberTabs tabs={tabs} label={t("tabs")} />
    </>
  );
}
