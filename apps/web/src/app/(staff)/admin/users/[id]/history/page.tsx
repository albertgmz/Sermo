import { usersAdminLog } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { UserLink } from "@/components/forum/user-link";
import { cursorFrom } from "@/components/staff/cursor-list";
import { LogTable } from "@/components/staff/log-table";
import { linkClass } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../../../registry";
import { memberIdOf } from "../../data";
import { TabPage } from "../../tab-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.history");
  return { title: t("metaTitle") };
}

async function History({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/users/[id]/history">["params"];
  searchParams: PageProps<"/admin/users/[id]/history">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const query = await searchParams;
  const [t, viewer, page] = await Promise.all([
    getTranslations("adminUsers.history"),
    getViewer(),
    read(usersAdminLog, { userId, cursor: cursorFrom(query) }),
  ]);
  const who = await membersFor(page.items.map((entry) => entry.actor));
  const economy = hrefFor(viewer, "usersEconomy");
  const grants = hrefFor(viewer, "economyAwardGrants");
  const promotions = hrefFor(viewer, "toolsPromotionLog");
  const ledger = hrefFor(viewer, "toolsCreditLedger");
  const links = [
    [economy?.replace("[id]", String(userId)), t("ledger")],
    [grants, t("awardGrants")],
    [promotions, t("promotions")],
    [ledger, t("creditLog")],
  ] as const;
  return (
    <>
      <LogTable
        entries={page.items.map((entry) => ({
          id: entry.id,
          at: entry.createdAt,
          actor: <UserLink user={who(entry.actor.id)} />,
          action: entry.action,
          target: t("target"),
          details: entry.details,
          reason: entry.reason,
        }))}
        nextCursor={page.nextCursor}
        path={`/admin/users/${userId}/history`}
        params={query}
        label={t("heading")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      />
      <section className="space-y-2 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("elsewhere")}</h2>
        <p className="text-sm text-pretty text-muted-foreground">
          {t("elsewhereHelp")}
        </p>
        <ul className="flex flex-wrap gap-x-4">
          {links.map(([href, label]) =>
            href ? (
              <li key={label}>
                <Link href={href} className={linkClass}>
                  {label}
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      </section>
    </>
  );
}

export default function MemberHistoryPage({
  params,
  searchParams,
}: PageProps<"/admin/users/[id]/history">) {
  const t = useTranslations("adminUsers.history");
  return (
    <TabPage label={t("loading")} rows={4}>
      <History params={params} searchParams={searchParams} />
    </TabPage>
  );
}
