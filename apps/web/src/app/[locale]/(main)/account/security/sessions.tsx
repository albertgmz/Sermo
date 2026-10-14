import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  revokeDevice,
  revokeOtherDevices,
} from "@/app/[locale]/(main)/account/security/actions";
import {
  Notice,
  noticeOf,
} from "@/app/[locale]/(main)/account/security/notice";
import { ClientIcons } from "@/components/forum/client-icons";
import { PendingButton } from "@/components/forum/pending-button";
import { Badge } from "@/components/ui/badge";
import { parseUserAgent } from "@/lib/client";
import { formatDateTime } from "@/lib/format";
import { shortAddress } from "@/lib/ip-address";
import { getCurrentAccount, listSessions } from "@/lib/sermo/auth";

export async function Sessions({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, listing, account, notice] = await Promise.all([
    getTranslations("account.security"),
    listSessions(),
    getCurrentAccount(),
    noticeOf(searchParams, ["revoked", "others", "revokeFailed"]),
  ]);
  if (!account || listing.code === "UNAUTHORIZED") redirect("/login");
  // Only what is shown reaches the page: the token of a session stays on the server.
  const sessions = listing.sessions
    .map((session) => ({
      id: session.id,
      current: session.id === account.sessionId,
      client: parseUserAgent(session.userAgent ?? ""),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      ipAddress: session.ipAddress,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current));
  const failure = listing.ok
    ? undefined
    : listing.code === "SESSION_NOT_FRESH"
      ? t("devicesNotFresh")
      : t("devicesFailed");

  return (
    <section id="sessions" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("devicesHeading")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("devicesDescription")}
        </p>
      </div>
      <Notice notice={notice} />
      {failure ? (
        <p role="alert" className="p-4 text-sm text-muted-foreground">
          {failure}
        </p>
      ) : sessions.length ? (
        <ul className="divide-y">
          {sessions.map((session) => {
            const device = t("deviceLabel", {
              browser: session.client.browser,
              os: session.client.os,
            });
            return (
              <li
                key={session.id}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5"
              >
                <ClientIcons client={session.client} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                    {device}
                    {session.current && (
                      <Badge variant="success">{t("currentDevice")}</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.rich("sessionDates", {
                      createdTime: (chunks) => (
                        <time dateTime={session.createdAt}>{chunks}</time>
                      ),
                      expiresTime: (chunks) => (
                        <time dateTime={session.expiresAt}>{chunks}</time>
                      ),
                      separator: (chunks) => (
                        <span aria-hidden="true">{chunks}</span>
                      ),
                      created: formatDateTime(session.createdAt),
                      expires: formatDateTime(session.expiresAt),
                    })}
                  </p>
                  {session.ipAddress && (
                    <p className="text-xs break-all text-muted-foreground">
                      {t("sessionIp", { ip: shortAddress(session.ipAddress) })}
                    </p>
                  )}
                </div>
                {!session.current && (
                  <form action={revokeDevice}>
                    <input type="hidden" name="session" value={session.id} />
                    <PendingButton
                      variant="outline"
                      className="min-h-10 px-3"
                      aria-label={t("revokeLabel", { device })}
                    >
                      {t("revoke")}
                    </PendingButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {sessions.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 border-t p-4">
          <form action={revokeOtherDevices}>
            <PendingButton variant="outline" className="min-h-10 px-4">
              {t("revokeOthers")}
            </PendingButton>
          </form>
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">
            {t("revokeOthersDescription")}
          </p>
        </div>
      )}
    </section>
  );
}
