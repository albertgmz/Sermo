import { creditsHistory } from "@sermo/core/contracts";
import { ReceiptText } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { LoadMore } from "@/components/forum/load-more";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { formatNumber } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

// The member's ledger, newest first. A line is named by its type; the reason the backend recorded
// (the credit rule, the staff note) is the detail under it.
export async function History({ cursor }: { cursor?: string }) {
  const locale = await getLocale();
  const [t, loadMore, ledger] = await Promise.all([
    getTranslations("credits.history"),
    getTranslations("credits.loadMore"),
    read(creditsHistory, { cursor }),
  ]);
  const href = ledger.nextCursor
    ? `/credits?tab=history&cursor=${encodeURIComponent(ledger.nextCursor)}`
    : null;
  return (
    <SectionCard title={t("heading")}>
      {ledger.items.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ul className="divide-y divide-border">
          {ledger.items.map((line) => (
            <li
              key={line.id}
              className="flex min-h-12 items-center justify-between gap-3 px-4 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {line.type === "adjustment" && line.actor
                    ? t("types.adjustmentBy", { name: line.actor.username })
                    : t(`types.${line.type}`)}
                </p>
                {line.reason && (
                  <p className="truncate text-xs text-muted-foreground">
                    {line.reason}
                  </p>
                )}
                <RelativeTime
                  date={line.createdAt}
                  className="text-xs text-muted-foreground"
                />
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    line.amount < 0 ? "text-destructive" : "text-success",
                  )}
                >
                  {line.amount < 0 ? "−" : "+"}
                  {formatNumber(Math.abs(line.amount), locale)}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {t("balanceAfter", {
                    balance: formatNumber(line.balanceAfter, locale),
                  })}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {href && (
        <div className="p-3">
          <LoadMore href={href}>{loadMore("label")}</LoadMore>
        </div>
      )}
    </SectionCard>
  );
}
