import { promotionsList, promotionsLog } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { cursorFrom } from "@/components/staff/cursor-list";
import { LogTable } from "@/components/staff/log-table";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { getGroups, groupLabel } from "../../groups/data";
import { MemberLink, memberNames, panelHref } from "../links";
import { MemberFilter, memberFilterId } from "../member-filter";

type Params = PageProps<"/admin/logs/promotions">["searchParams"];

// The promotion changes, automatic and manual, newest first, or those of one member.
export async function PromotionLog({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const userId = memberFilterId(params, "userId") ?? undefined;
  const [t, action, viewer, page, promotions, groups] = await Promise.all([
    getTranslations("adminTools.promotionLog"),
    getTranslations("adminTools.promotionLog.action"),
    getViewer(),
    read(promotionsLog, { userId, cursor: cursorFrom(params), limit: 25 }),
    read(promotionsList, {}),
    getGroups(),
  ]);
  const name = await memberNames(
    page.items.flatMap((entry) => [
      entry.userId,
      ...(entry.actorId ? [entry.actorId] : []),
    ]),
  );
  const titles = new Map(promotions.items.map((item) => [item.id, item.title]));
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
        path="/admin/logs/promotions"
        params={params}
        param="userId"
        heading={t("member")}
      />
      <LogTable
        label={t("heading")}
        path="/admin/logs/promotions"
        params={params}
        nextCursor={page.nextCursor}
        entries={page.items.map((entry) => ({
          id: entry.id,
          at: entry.createdAt,
          actor: entry.actorId ? member(entry.actorId) : t("automatic"),
          action: action(entry.action),
          target: member(entry.userId),
          details: {
            [t("promotion")]:
              titles.get(entry.promotionId) ??
              t("promotionNumber", { id: entry.promotionId }),
            [t("groups")]: entry.groupIds
              .map((id) =>
                groupLabel(groups, id, (n) => t("groupNumber", { id: n })),
              )
              .join(", "),
          },
        }))}
        empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      />
    </>
  );
}
