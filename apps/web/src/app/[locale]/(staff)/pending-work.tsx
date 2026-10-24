import { ClipboardCheck, Flag, UserCheck } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { StatTile } from "@/components/forum/stat";
import { getCounters } from "@/components/layout/header-data";
import { getViewer } from "@/lib/sermo/session";
import { pendingCount } from "./pending-count";
import { canOpen, hrefFor, screenByKey } from "./registry";

// Open reports, the approval queue and the sign-ups waiting, each shown only to a member who may open its screen and
// linked to it once that screen is built.
export async function PendingWork({ heading }: { heading?: boolean }) {
  const [viewer, t, format, counters] = await Promise.all([
    getViewer(),
    getTranslations("admin.homePending"),
    getFormatter(),
    getCounters(),
  ]);
  const reports = canOpen(viewer, screenByKey("moderationReports"))
    ? counters.openReports
    : null;
  const approvals = canOpen(viewer, screenByKey("moderationApprovals"))
    ? counters.pendingApprovals
    : null;
  const signups = canOpen(viewer, screenByKey("moderationSignups"))
    ? counters.pendingSignups
    : null;
  const tiles = [
    {
      key: "reports",
      label: t("reports"),
      icon: Flag,
      queue: reports,
      href: hrefFor(viewer, "moderationReports"),
    },
    {
      key: "approvals",
      label: t("approvals"),
      icon: ClipboardCheck,
      queue: approvals,
      href: hrefFor(viewer, "moderationApprovals"),
    },
    {
      key: "signups",
      label: t("signups"),
      icon: UserCheck,
      queue: signups,
      href: hrefFor(viewer, "moderationSignups"),
    },
  ].filter((tile) => tile.queue !== null);
  if (tiles.length === 0) return null;
  return (
    <section className="space-y-3">
      {heading !== false && (
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ key, label, icon, queue, href }) => {
          const shown = pendingCount(queue ?? { count: 0, more: false });
          const value = shown.more
            ? t("capped", { count: format.number(shown.count) })
            : format.number(shown.count);
          return (
            <StatTile
              key={key}
              label={label}
              value={value}
              icon={icon}
              href={href ?? undefined}
              action={t("open")}
            />
          );
        })}
      </div>
    </section>
  );
}
