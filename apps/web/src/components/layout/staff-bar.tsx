import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type PendingCount,
  pendingTotal,
} from "@/app/[locale]/(staff)/pending-count";
import {
  canOpen,
  type Standing,
  screenByKey,
} from "@/app/[locale]/(staff)/registry";
import { Container } from "@/components/layout/container";
import type { Counters } from "@/components/layout/header-data";

const ITEM =
  "inline-flex h-10 items-center rounded-md px-2 font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8";

// What the staff bar links to for this viewer: the panel when it has a home for them (the backend
// says there is anything in it, or a screen of it opens), and moderation when they may open a moderation screen.
// Moderation leads to the first queue the viewer may open (approvals, then reports) and to the
// landing page only when they have neither.
export function staffLinks(viewer: Standing) {
  const moderationHref = canOpen(viewer, screenByKey("moderationApprovals"))
    ? "/moderation/approvals"
    : canOpen(viewer, screenByKey("moderationReports"))
      ? "/moderation/reports"
      : "/moderation";
  return {
    admin: canOpen(viewer, screenByKey("home")),
    moderation: canOpen(viewer, screenByKey("moderationHome")),
    moderationHref,
  };
}

// The moderation link's badge: the open reports and the approvals waiting together, or null when
// there are none. A "+" follows the count when a queue was cut off at the backend's bound.
export function pendingBadge(
  counters: Pick<Counters, "openReports" | "pendingApprovals">,
): PendingCount | null {
  return pendingTotal(counters.openReports, counters.pendingApprovals);
}

export function StaffBar({
  admin,
  moderation,
  moderationHref = "/moderation/approvals",
  pending = null,
}: {
  admin: boolean;
  moderation: boolean;
  moderationHref?: string;
  pending?: PendingCount | null;
}) {
  const t = useTranslations("layout.staffBar");
  const badge =
    pending &&
    (pending.more
      ? t("capped", { count: pending.count })
      : String(pending.count));
  return (
    <div className="border-b bg-background text-xs text-muted-foreground">
      <Container className="flex items-center">
        <div className="-ml-2 flex items-center">
          {admin && (
            <Link href="/admin" className={ITEM}>
              {t("admin")}
            </Link>
          )}
          {moderation && (
            <Link href={moderationHref} className={ITEM}>
              {t("moderation")}
              {badge && (
                <>
                  <span
                    aria-hidden="true"
                    className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground"
                  >
                    {badge}
                  </span>
                  <span className="sr-only">
                    {t("pending", { count: badge })}
                  </span>
                </>
              )}
            </Link>
          )}
        </div>
      </Container>
    </div>
  );
}
