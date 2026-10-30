import { usersAdminSessions } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { ClientIcons } from "@/components/forum/client-icons";
import { EmptyState } from "@/components/forum/empty-state";
import { RelativeTime } from "@/components/forum/relative-time";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Help, Section } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { getMember, ifAllowed, isReadOnly, memberIdOf } from "../../data";
import { TabPage } from "../../tab-page";
import { revokeSessions } from "./actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.sessions");
  return { title: t("metaTitle") };
}

async function Sessions({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/users/[id]/sessions">["params"];
  searchParams: PageProps<"/[locale]/admin/users/[id]/sessions">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, format, member, sessions] = await Promise.all([
    getTranslations("adminUsers.sessions"),
    getFormatter(),
    getMember(userId),
    ifAllowed(() => read(usersAdminSessions, { userId })),
  ]);
  if (!sessions) {
    return (
      <Section heading={t("heading")}>
        <EmptyState
          title={t("refusedTitle")}
          description={t("refusedDescription")}
        />
      </Section>
    );
  }
  const { items } = sessions;
  const readOnly = isReadOnly(member);
  const when = (at: string) =>
    format.dateTime(new Date(at), { dateStyle: "medium", timeStyle: "short" });
  return (
    <>
      <Notice
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={["revoked", "allRevoked"]}
      />
      <ItemList
        label={t("heading")}
        heading={t("heading")}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
        items={items.map((session) => ({
          id: session.id,
          title: (
            <span className="inline-flex flex-wrap items-center gap-x-2">
              <ClientIcons client={session.device} />
              {session.userAgent ?? t("unknown")}
            </span>
          ),
          description: (
            <>
              <span className="block">
                {t("address")}: {session.ipAddress ?? t("unknown")}
              </span>
              <span className="flex flex-wrap gap-x-3">
                <span>
                  {t("created")}: <RelativeTime date={session.createdAt} />
                </span>
                <span>
                  {t("expires")}:{" "}
                  <time dateTime={session.expiresAt}>
                    {when(session.expiresAt)}
                  </time>
                </span>
              </span>
            </>
          ),
          actions: readOnly ? undefined : (
            <ConfirmStep
              action={revokeSessions}
              fields={{ id: userId, sessionId: session.id }}
              summary={t("revokeOne")}
              reason={t("reason")}
              warning={t("revokeOneWarning")}
            />
          ),
        }))}
      />
      <div className="space-y-2 rounded-lg border bg-card p-4">
        <Help>{t("revokeOneHelp")}</Help>
        {!readOnly && items.length > 0 && (
          <ConfirmStep
            action={revokeSessions}
            fields={{ id: userId }}
            summary={t("revokeAll")}
            reason={t("reason")}
            warning={t("revokeAllWarning")}
          />
        )}
      </div>
    </>
  );
}

export default function MemberSessionsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users/[id]/sessions">) {
  const t = useTranslations("adminUsers.sessions");
  return (
    <TabPage label={t("loading")} rows={3}>
      <Sessions params={params} searchParams={searchParams} />
    </TabPage>
  );
}
