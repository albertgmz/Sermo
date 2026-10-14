import { creditsLedger } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { cursorFrom } from "@/components/staff/cursor-list";
import { LogTable } from "@/components/staff/log-table";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { MemberLink, memberNames, panelHref } from "../links";
import { MemberFilter, memberFilterId } from "../member-filter";

type Params = PageProps<"/[locale]/admin/logs/credits">["searchParams"];

// The credit ledger of everyone, newest first, or of one member (then with their balance). The
// read has no type filter.
export async function CreditLedger({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const userId = memberFilterId(params, "userId") ?? undefined;
  const [t, kinds, format, viewer, page] = await Promise.all([
    getTranslations("adminTools.creditLedger"),
    getTranslations("credits.history.types"),
    getFormatter(),
    getViewer(),
    read(creditsLedger, { userId, cursor: cursorFrom(params), limit: 25 }),
  ]);
  const name = await memberNames(
    page.items.flatMap((row) => [
      row.userId,
      ...(row.actor ? [row.actor.id] : []),
    ]),
    page.items.flatMap((row) => (row.actor ? [row.actor] : [])),
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
        path="/admin/logs/credits"
        params={params}
        param="userId"
        heading={t("member")}
      />
      {page.balance !== null && (
        <p className="rounded-lg border bg-card px-4 py-2.5 text-sm font-medium">
          {t("balance", { balance: format.number(page.balance) })}
        </p>
      )}
      <LogTable
        label={t("heading")}
        path="/admin/logs/credits"
        params={params}
        nextCursor={page.nextCursor}
        entries={page.items.map((row) => ({
          id: row.id,
          at: row.createdAt,
          actor: row.actor ? member(row.actor.id) : null,
          action: `${kinds(row.type)} ${format.number(row.amount, { signDisplay: "always" })}`,
          target: member(row.userId),
          details: {
            [t("balanceAfter")]: row.balanceAfter,
            ...(row.source && {
              [t("source")]: t("sourceValue", {
                type: row.source.type,
                id: row.source.id,
              }),
            }),
          },
          reason: row.reason || undefined,
        }))}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      />
    </>
  );
}
