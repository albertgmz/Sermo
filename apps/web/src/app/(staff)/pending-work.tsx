import { approvalsList, reportsList } from "@sermo/core/contracts";
import { ClipboardCheck, Flag } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { StatTile } from "@/components/forum/stat";
import { call } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { orNothing } from "./or-nothing";
import { canOpen, hrefFor, screenByKey } from "./registry";

// The queues are read at the largest page the backend gives. It has no read that counts, so a
// queue longer than this shows as "100+".
const PAGE = 100;

const LINK =
  "mt-3 inline-flex min-h-10 items-center text-xs text-primary underline-offset-4 hover:underline";

// Open reports and the approval queue, each shown only to a member who may open its screen and
// linked to it once that screen is built.
export async function PendingWork({ heading }: { heading?: boolean }) {
  const [viewer, t, format] = await Promise.all([
    getViewer(),
    getTranslations("admin.homePending"),
    getFormatter(),
  ]);
  const [reports, approvals] = await Promise.all([
    canOpen(viewer, screenByKey("moderationReports"))
      ? orNothing(() => call(reportsList, { state: "open", limit: PAGE }))
      : null,
    canOpen(viewer, screenByKey("moderationApprovals"))
      ? orNothing(() => call(approvalsList, { limit: PAGE }))
      : null,
  ]);
  const tiles = [
    {
      key: "reports",
      label: t("reports"),
      icon: Flag,
      page: reports,
      href: hrefFor(viewer, "moderationReports"),
    },
    {
      key: "approvals",
      label: t("approvals"),
      icon: ClipboardCheck,
      page: approvals,
      href: hrefFor(viewer, "moderationApprovals"),
    },
  ].filter((tile) => tile.page !== null);
  if (tiles.length === 0) return null;
  return (
    <section className="space-y-3">
      {heading !== false && (
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {tiles.map(({ key, label, icon, page, href }) => {
          const count = page?.items.length ?? 0;
          const value = page?.nextCursor
            ? t("capped", { count: format.number(PAGE) })
            : format.number(count);
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
