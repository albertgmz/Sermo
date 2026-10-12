import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { logout } from "@/app/(main)/actions";
import { ClientIcons, clientLabel } from "@/components/forum/client-icons";
import { PendingButton } from "@/components/forum/pending-button";
import { Badge } from "@/components/ui/badge";
import { getClientInfo } from "@/lib/client";
import { getSessions } from "@/lib/db";
import { formatDate, formatDateTime, formatRelativeTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Security - forum/ui" };

export default async function SecurityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [sessions, client] = await Promise.all([
    getSessions(user.id),
    getClientInfo(),
  ]);
  const now = new Date();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Security</h1>
      <section id="devices" className="scroll-mt-4 rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">Devices</h2>
          <p className="text-xs text-muted-foreground">
            Browsers that are signed in to your account.
          </p>
        </div>
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
                    {clientLabel(session)}
                    {session.browser === client.browser &&
                      session.os === client.os && (
                        <Badge variant="success">This device</Badge>
                      )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Signed in{" "}
                    <time dateTime={session.createdAt}>
                      {formatDate(session.createdAt)}
                    </time>
                    <span aria-hidden="true"> · </span>
                    Last used{" "}
                    <time
                      dateTime={session.lastUsedAt}
                      title={formatDateTime(session.lastUsedAt)}
                    >
                      {formatRelativeTime(session.lastUsedAt, now)}
                    </time>
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            No devices are signed in.
          </p>
        )}
      </section>
      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">Log out</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          End your session in this browser.
        </p>
        <form action={logout} className="mt-3">
          <PendingButton variant="outline" className="min-h-10 px-4">
            Log out
          </PendingButton>
        </form>
      </section>
    </div>
  );
}
