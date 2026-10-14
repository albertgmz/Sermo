import { shopPurchases } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { cursorFrom } from "@/components/staff/cursor-list";
import { LogTable } from "@/components/staff/log-table";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { MemberLink, memberNames, panelHref } from "../links";
import { MemberFilter, memberFilterId } from "../member-filter";

type Params = PageProps<"/[locale]/admin/logs/purchases">["searchParams"];

// The purchase log, newest first, or the purchases of one buyer. The read also takes an item,
// which this screen does not offer.
export async function PurchaseLog({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const buyerId = memberFilterId(params, "buyerId") ?? undefined;
  const [t, format, viewer, page] = await Promise.all([
    getTranslations("adminTools.purchases"),
    getFormatter(),
    getViewer(),
    read(shopPurchases, { buyerId, cursor: cursorFrom(params), limit: 25 }),
  ]);
  const name = await memberNames(
    [],
    page.items.flatMap((row) => [row.buyer, row.recipient]),
  );
  const member = (id: number) => (
    <MemberLink
      id={id}
      name={name(id)}
      panel={panelHref(viewer, "usersEdit", id)}
    />
  );
  return (
    <>
      <MemberFilter
        path="/admin/logs/purchases"
        params={params}
        param="buyerId"
        heading={t("buyer")}
      />
      <LogTable
        label={t("heading")}
        path="/admin/logs/purchases"
        params={params}
        nextCursor={page.nextCursor}
        entries={page.items.map((row) => ({
          id: row.id,
          at: row.createdAt,
          actor: member(row.buyer.id),
          action:
            row.quantity > 1
              ? t("boughtMany", { quantity: row.quantity, item: row.item.name })
              : t("bought", { item: row.item.name }),
          target:
            row.recipient.id === row.buyer.id ? (
              row.item.name
            ) : (
              <>
                {t("gift")} {member(row.recipient.id)}
              </>
            ),
          details: {
            [t("item")]: row.item.id,
            [t("quantity")]: row.quantity,
            [t("price")]: format.number(row.price),
          },
        }))}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      />
    </>
  );
}
