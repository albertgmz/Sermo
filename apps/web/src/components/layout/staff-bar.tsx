import Link from "next/link";
import { useTranslations } from "next-intl";
import { canOpen, type Standing, screenByKey } from "@/app/(staff)/registry";
import { Container } from "@/components/layout/container";
import type { Counters } from "@/components/layout/header-data";

const ITEM =
  "inline-flex h-10 items-center rounded-md px-2 font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8";

// What the staff bar links to for this viewer: the panel when the backend says there is anything
// in it for them, and the moderation landing when they may open a moderation screen.
export function staffLinks(viewer: Standing) {
  return {
    admin: viewer.staff.panel,
    moderation: canOpen(viewer, screenByKey("moderationHome")),
  };
}

// The moderation link's badge: the open reports and the approvals waiting together, or null when
// there are none. Each count stops at 99, so a queue that has more makes the sum "99+".
export function pendingBadge(
  counters: Pick<Counters, "openReports" | "pendingApprovals">,
): string | null {
  const { openReports, pendingApprovals } = counters;
  const sum = openReports.count + pendingApprovals.count;
  if (sum === 0) return null;
  return sum > 99 || openReports.more || pendingApprovals.more
    ? "99+"
    : String(sum);
}

export function StaffBar({
  admin,
  moderation,
  pending = null,
}: {
  admin: boolean;
  moderation: boolean;
  pending?: string | null;
}) {
  const t = useTranslations("layout.staffBar");
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
            <Link href="/moderation" className={ITEM}>
              {t("moderation")}
              {pending && (
                <>
                  <span
                    aria-hidden="true"
                    className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground"
                  >
                    {pending}
                  </span>
                  <span className="sr-only">
                    {t("pending", { count: pending })}
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
