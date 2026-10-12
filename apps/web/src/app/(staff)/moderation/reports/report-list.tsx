import { reportsGet, reportsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { call, read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { memberNames } from "../../admin/logs/links";
import { describe, orGone } from "../content";
import { FilterBar, first, forumOptions } from "../filter-bar";
import { Where } from "../where";

type Params = PageProps<"/moderation/reports">["searchParams"];

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

// The report queue as the backend returns it for this viewer. The read names the reported item
// and the counts only; what each row shows of the content and of who reported it is read per row.
export async function ReportList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const state = stateOf(params.state);
  const nodeId = parseId(first(params.nodeId)) ?? undefined;
  const [t, type, stateText, forums, page] = await Promise.all([
    getTranslations("moderation.reports"),
    getTranslations("moderation.common.type"),
    getTranslations("moderation.common.state"),
    forumOptions(),
    read(reportsList, {
      state,
      nodeId,
      cursor: cursorFrom(params),
      limit: 20,
    }),
  ]);
  const rows = await Promise.all(
    page.items.map(async (group) => {
      const [detail, full] = await Promise.all([
        describe(group.targetType, group.targetId, false),
        orGone(() => call(reportsGet, { groupId: group.id })),
      ]);
      return { group, detail, reporterId: full?.reports[0]?.reporterId };
    }),
  );
  const ids = rows.flatMap(({ group, detail, reporterId }) => [
    ...(reporterId ? [reporterId] : []),
    ...(group.assignedToId ? [group.assignedToId] : []),
    ...(detail.where?.kind === "wall" ? [detail.where.id] : []),
  ]);
  const name = await memberNames(ids);
  return (
    <CursorList
      items={rows}
      nextCursor={page.nextCursor}
      path="/moderation/reports"
      params={params}
      itemKey={({ group }) => group.id}
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
      render={({ group, detail, reporterId }) => (
        <article className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{type(group.targetType)}</Badge>
              <Badge variant={STATE_BADGE[group.state]}>
                {stateText(group.state)}
              </Badge>
              <Badge variant="outline">
                {t("reportCount", { count: group.reportCount })}
              </Badge>
            </p>
            {detail.excerpt && (
              <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                {detail.excerpt}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <Where where={detail.where} name={name} />
              {detail.author && (
                <span>{t("by", { name: detail.author.username })}</span>
              )}
            </p>
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
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
          </div>
          <Link
            href={`/moderation/reports/${group.id}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            {t("open")}
          </Link>
        </article>
      )}
    />
  );
}
