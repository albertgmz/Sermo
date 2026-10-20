import { creditsHistory } from "@sermo/core/contracts";
import { getLocale, getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { formatCredits } from "@/lib/format";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

// One page of the member's ledger, newest first, drawn: the list's first page and each page the
// browser asks for. A line is named by its type; the reason the backend recorded (the credit rule,
// the staff note) is the detail under it.
export async function historyPage(
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [locale, t, ledger] = await Promise.all([
    getLocale(),
    getTranslations("credits.history"),
    reader(creditsHistory, { cursor }),
  ]);
  return {
    nextCursor: ledger.nextCursor,
    rows: ledger.items.map((line) => ({
      key: String(line.id),
      node: (
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
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
              {formatCredits(Math.abs(line.amount), locale)}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("balanceAfter", {
                balance: formatCredits(line.balanceAfter, locale),
              })}
            </p>
          </div>
        </div>
      ),
    })),
  };
}
