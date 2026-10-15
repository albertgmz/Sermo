import { ReceiptText } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { historyPage } from "@/app/[locale]/(main)/credits/history-page";
import { moreHistory } from "@/app/[locale]/(main)/credits/more-history";
import { PagedCard } from "@/components/forum/paged-card";

// The member's ledger, newest first.
export async function History({
  cursor,
  pages,
}: {
  cursor?: string;
  pages: number;
}) {
  const [t, loadMore, first] = await Promise.all([
    getTranslations("credits.history"),
    getTranslations("credits.loadMore"),
    historyPage(cursor),
  ]);
  return (
    <PagedCard
      title={t("heading")}
      empty={{
        icon: ReceiptText,
        title: t("emptyTitle"),
        description: t("emptyDescription"),
      }}
      first={first}
      more={moreHistory}
      pages={pages}
      start={cursor}
      listKey={["credits", "history"]}
      hrefBase="/credits?tab=history"
      moreLabel={loadMore("label")}
      estimateSize={64}
      as="ul"
    />
  );
}
