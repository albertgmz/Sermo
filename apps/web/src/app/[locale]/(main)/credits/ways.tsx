import { creditsWays } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { SectionCard } from "@/components/forum/section-card";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

// The ways to earn (or lose) credits: one row per active rule, for guests too. The title is what
// the administrator wrote; the trigger is phrased here, as the backend only names it.
export async function Ways() {
  const [t, { items }] = await Promise.all([
    getTranslations("credits.ways"),
    read(creditsWays, {}),
  ]);
  return (
    <SectionCard title={t("heading")} description={t("description")}>
      {items.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul aria-label={t("heading")} className="divide-y">
          {items.map((way, index) => (
            // The list has no ids: a rule is told apart by where it stands.
            // biome-ignore lint/suspicious/noArrayIndexKey: the answer carries no id
            <li key={index} className="space-y-1 p-4">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 text-sm font-semibold [overflow-wrap:anywhere]">
                  {way.title}
                </p>
                <p
                  className={cn(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    way.amount > 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {t("amount", {
                    sign: way.amount < 0 ? "minus" : "plus",
                    value: Math.abs(way.amount),
                  })}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(`triggers.${way.trigger}`)}
              </p>
              {way.limit && (
                <p className="text-xs text-muted-foreground">
                  {t("limit", {
                    count: way.limit.count,
                    hours: way.limit.windowHours,
                  })}
                </p>
              )}
              {way.forums.length > 0 && (
                <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                  {t("forums")}
                  {way.forums.map((forum, position) => (
                    <span key={forum.id}>
                      <Link
                        href={`/forums/${forum.id}`}
                        className="inline-flex min-h-10 items-center text-primary-ink underline-offset-4 hover:underline"
                      >
                        {forum.title}
                      </Link>
                      {position < way.forums.length - 1 && ","}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
