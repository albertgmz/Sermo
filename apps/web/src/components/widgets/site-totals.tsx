import { siteStats } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { SectionCard } from "@/components/forum/section-card";
import { CardSkeleton } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";

const rowClass = "flex items-baseline justify-between gap-3 px-4 py-2 text-sm";

// The site's threads, messages and members, and its newest member (a name the visitor may not see
// is left out). Nothing when the site is closed to the visitor.
export async function SiteTotals({ title }: WidgetBodyProps<"siteTotals">) {
  const stats = await readIfAllowed(siteStats, {});
  if (!stats) return null;
  const [t, format] = await Promise.all([
    getTranslations("widgets.siteTotals"),
    getFormatter(),
  ]);
  return (
    <SectionCard title={title}>
      <dl className="divide-y divide-border">
        {(["threads", "posts", "members"] as const).map((key) => (
          <div key={key} className={rowClass}>
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd className="font-medium tabular-nums">
              {format.number(stats[key])}
            </dd>
          </div>
        ))}
        {stats.latestMember && (
          <div className={rowClass}>
            <dt className="text-muted-foreground">{t("latestMember")}</dt>
            <dd className="min-w-0 truncate font-medium">
              <UserLink user={stats.latestMember} />
            </dd>
          </div>
        )}
      </dl>
    </SectionCard>
  );
}

export function SiteTotalsSkeleton() {
  return (
    <CardSkeleton>
      {["threads", "posts", "members", "latest"].map((key) => (
        <div key={key} className="flex h-9 items-center justify-between px-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-12" />
        </div>
      ))}
    </CardSkeleton>
  );
}
