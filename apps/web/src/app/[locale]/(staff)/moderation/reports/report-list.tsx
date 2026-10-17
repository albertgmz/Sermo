import { reportsGet, reportsList } from "@sermo/core/contracts";
import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { cursorFrom } from "@/components/staff/cursor-list";
import { RowLink } from "@/components/staff/item-list";
import { PagedList } from "@/components/staff/paged-list";
import { Badge } from "@/components/ui/badge";
import { call, read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { memberNames } from "../../admin/logs/links";
import { orGone } from "../content";
import { FilterBar, first, forumOptions } from "../filter-bar";
import { QueuePlace } from "../where";

type Params = PageProps<"/[locale]/moderation/reports">["searchParams"];

const STATES = ["open", "assigned", "resolved", "rejected"] as const;
type State = (typeof STATES)[number];

export const STATE_BADGE = {
  open: "default",
  assigned: "secondary",
  resolved: "success",
  rejected: "outline",
} as const;

// The state the read is asked for: the one in the address, "open" before any choice, none for
// "All". Anything else in the address is no state.
function stateOf(raw: string | string[] | undefined): State | undefined {
  if (raw === undefined) return "open";
  return STATES.find((state) => state === first(raw));
}

// The report queue as the backend returns it for this viewer. Each row carries an excerpt of the
// reported content and the place it is in; only who reported it is read per row.
export async function ReportList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const state = stateOf(params.state);
  const nodeId = parseId(first(params.nodeId)) ?? undefined;
  const [t, type, stateText, forums, page] = await Promise.all([
    getTranslations("moderation.reports"),
    getTranslations("moderation.common.type"),
    getTranslations("moderation.common.state"),
    forumOptions({ moderated: true }),
    read(reportsList, {
      state,
      nodeId,
      cursor: cursorFrom(params),
      limit: 20,
    }),
  ]);
  const rows = await Promise.all(
    page.items.map(async (group) => {
      const full = await orGone(() => call(reportsGet, { groupId: group.id }));
      return { group, reporterId: full?.reports[0]?.reporterId };
    }),
  );
  const ids = rows.flatMap(({ group, reporterId }) => [
    ...(reporterId ? [reporterId] : []),
    ...(group.assignedToId ? [group.assignedToId] : []),
  ]);
  const name = await memberNames(ids);
  return (
    <PagedList
      items={rows.map(({ group, reporterId }) => ({
        id: group.id,
        title: (
          <span className="line-clamp-2">
            {group.excerpt || `${type(group.targetType)} #${group.targetId}`}
          </span>
        ),
        href: `/moderation/reports/${group.id}`,
        badges: (
          <>
            <Badge variant="secondary">{type(group.targetType)}</Badge>
            <Badge variant={STATE_BADGE[group.state]}>
              {stateText(group.state)}
            </Badge>
            <Badge variant="outline">
              {t("reportCount", { count: group.reportCount })}
            </Badge>
          </>
        ),
        description: (
          <>
            <p className="flex flex-wrap items-center gap-x-3">
              <QueuePlace where={group.where} />
            </p>
            <p className="flex flex-wrap items-center gap-x-3">
              {reporterId && (
                <span>
                  {t("reportedBy", { name: name(reporterId) })}
                  {group.reportCount > 1 &&
                    ` ${t("others", { count: group.reportCount - 1 })}`}
                </span>
              )}
              <span>
                {t("reported")} <RelativeTime date={group.createdAt} />
              </span>
              {group.assignedToId && (
                <span>
                  {t("assignedTo", { name: name(group.assignedToId) })}
                </span>
              )}
            </p>
          </>
        ),
        actions: (
          <RowLink
            href={`/moderation/reports/${group.id}`}
            label={t("open")}
            icon={<Eye />}
          />
        ),
      }))}
      paging={{
        path: "/moderation/reports",
        params,
        nextCursor: page.nextCursor,
      }}
      label={t("list")}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      filters={
        <FilterBar
          path="/moderation/reports"
          params={params}
          states={STATES}
          stateDefault="open"
          forums={forums}
        />
      }
    />
  );
}
