import { ClipboardCheck, Flag } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { StatTile } from "@/components/forum/stat";
import { getCounters } from "@/components/layout/header-data";
import { getViewer } from "@/lib/sermo/session";
import { canOpen, hrefFor, screenByKey } from "./registry";

// What a queue counts stops at 99; `more` says the window was full.
const CAP = 99;

const LINK =
  "mt-3 inline-flex min-h-10 items-center text-xs text-primary underline-offset-4 hover:underline";

// Open reports and the approval queue, each shown only to a member who may open its screen and
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
  ].filter((tile) => tile.queue !== null);
  if (tiles.length === 0) return null;
  return (
    <section className="space-y-3">
      {heading !== false && (
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ key, label, icon, queue, href }) => {
          const value = queue?.more
            ? t("capped", { count: format.number(CAP) })
            : format.number(queue?.count ?? 0);
          return (
            <div key={key}>
              <StatTile label={label} value={value} icon={icon} />
              {href && (
                <Link href={href} className={LINK}>
                  {t("open")}
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
