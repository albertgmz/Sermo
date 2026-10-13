import { usersAdminSessions } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { Notice } from "@/components/staff/notice";
import { Help, Section } from "@/components/staff/rows";
import { shortAddress } from "@/lib/ip-address";
import { read } from "@/lib/sermo/client";
import { getMember, isReadOnly, memberIdOf } from "../../data";
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
  params: PageProps<"/admin/users/[id]/sessions">["params"];
  searchParams: PageProps<"/admin/users/[id]/sessions">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  const [t, format, member, { items }] = await Promise.all([
    getTranslations("adminUsers.sessions"),
    getFormatter(),
    getMember(userId),
    read(usersAdminSessions, { userId }),
  ]);
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
      <Section heading={t("heading")}>
        {items.length === 0 ? (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        ) : (
          <ul aria-label={t("heading")} className="divide-y">
            {items.map((session) => (
              <li key={session.id} className="space-y-2 p-4 text-sm">
                <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <dt className="text-muted-foreground">{t("created")}</dt>
                  <dd>
                    <time dateTime={session.createdAt}>
                      {when(session.createdAt)}
                    </time>
                  </dd>
                  <dt className="text-muted-foreground">{t("expires")}</dt>
                  <dd>
                    <time dateTime={session.expiresAt}>
                      {when(session.expiresAt)}
                    </time>
                  </dd>
                  <dt className="text-muted-foreground">{t("address")}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {session.ipAddress
                      ? shortAddress(session.ipAddress)
                      : t("unknown")}
                  </dd>
                  <dt className="text-muted-foreground">{t("userAgent")}</dt>
                  <dd className="[overflow-wrap:anywhere]">
                    {session.userAgent ?? t("unknown")}
                  </dd>
                </dl>
                {!readOnly && (
                  <ConfirmStep
                    action={revokeSessions}
                    fields={{ id: userId, sessionId: session.id }}
                    summary={t("revokeOne")}
                    reason={t("reason")}
                    warning={t("revokeOneWarning")}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="space-y-2 border-t p-4">
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
      </Section>
    </>
  );
}

export default function MemberSessionsPage({
  params,
  searchParams,
}: PageProps<"/admin/users/[id]/sessions">) {
  const t = useTranslations("adminUsers.sessions");
  return (
    <TabPage label={t("loading")} rows={3}>
      <Sessions params={params} searchParams={searchParams} />
    </TabPage>
  );
}
