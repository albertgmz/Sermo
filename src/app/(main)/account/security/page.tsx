import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { logout } from "@/app/(main)/actions";
import { ClientIcons } from "@/components/forum/client-icons";
import { PendingButton } from "@/components/forum/pending-button";
import { LoadingRegion, MemberRowSkeleton } from "@/components/forum/skeletons";
import { Badge } from "@/components/ui/badge";
import { getClientInfo } from "@/lib/client";
import { getSessions } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.security");
  return { title: t("metaTitle") };
}

export default function SecurityPage() {
  const t = useTranslations("account.security");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <section id="devices" className="scroll-mt-4 rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("devicesHeading")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("devicesDescription")}
          </p>
        </div>
        <Suspense
          fallback={
            <LoadingRegion label={t("devicesLoading")}>
              <MemberRowSkeleton />
              <MemberRowSkeleton />
            </LoadingRegion>
          }
        >
          <Devices />
        </Suspense>
      </section>
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("logoutHeading")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("logoutDescription")}
        </p>
        <form action={logout} className="mt-3">
          <PendingButton variant="outline" className="min-h-10 px-4">
            {t("logout")}
          </PendingButton>
        </form>
      </section>
    </div>
  );
}

async function Devices() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [sessions, client] = await Promise.all([
    getSessions(user.id),
    getClientInfo(),
  ]);
  const now = await getNow();
  const t = await getTranslations("account.security");
  const format = await getFormatter();

  return (
    <>
      {sessions.length ? (
        <ul className="divide-y">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5"
            >
              <ClientIcons client={session} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  {t("deviceLabel", {
                    browser: session.browser,
                    os: session.os,
                  })}
                  {session.browser === client.browser &&
                    session.os === client.os && (
                      <Badge variant="success">{t("currentDevice")}</Badge>
                    )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.rich("sessionDetails", {
                    date: formatDate(session.createdAt),
                    relativeTime: format.relativeTime(
                      new Date(session.lastUsedAt),
                      now,
                    ),
                    signedIn: (chunks) => (
                      <time dateTime={session.createdAt}>{chunks}</time>
                    ),
                    separator: (chunks) => (
                      <span aria-hidden="true">{chunks}</span>
                    ),
                    lastUsed: (chunks) => (
                      <time
                        dateTime={session.lastUsedAt}
                        title={formatDateTime(session.lastUsedAt)}
                      >
                        {chunks}
                      </time>
                    ),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
      )}
    </>
  );
}
