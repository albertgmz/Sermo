import { approvalsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { CursorList, cursorFrom } from "@/components/staff/cursor-list";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { MemberLink, memberNames } from "../../admin/logs/links";
import { describe } from "../content";
import { FilterBar, first, forumOptions } from "../filter-bar";
import { Where } from "../where";

type Params = PageProps<"/moderation/approvals">["searchParams"];

// The approval queue as the backend returns it for this viewer. The read gives the kind, the id,
// the author and the time; the excerpt and the place of each row are read per row.
export async function ApprovalList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const nodeId = parseId(first(params.nodeId)) ?? undefined;
  const [t, type, forums, page] = await Promise.all([
    getTranslations("moderation.approvals"),
    getTranslations("moderation.common.type"),
    forumOptions(),
    read(approvalsList, { nodeId, cursor: cursorFrom(params), limit: 20 }),
  ]);
  const rows = await Promise.all(
    page.items.map(async (item) => ({
      item,
      detail:
        item.type === "conversation_message"
          ? null
          : await describe(item.type, item.id, false),
    })),
  );
  const name = await memberNames(
    rows.flatMap(({ item, detail }) => [
      item.authorId,
      ...(detail?.where?.kind === "wall" ? [detail.where.id] : []),
    ]),
  );
  return (
    <CursorList
      items={rows}
      nextCursor={page.nextCursor}
      path="/moderation/approvals"
      params={params}
      itemKey={({ item }) => `${item.type}-${item.id}`}
      label={t("list")}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      filters={
        <FilterBar
          path="/moderation/approvals"
          params={params}
          forums={forums}
        />
      }
      render={({ item, detail }) => (
        <article className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{type(item.type)}</Badge>
            </p>
            {detail?.excerpt && (
              <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                {detail.excerpt}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              {detail && <Where where={detail.where} name={name} />}
              <MemberLink id={item.authorId} name={name(item.authorId)} />
              <span>
                {t("added")} <RelativeTime date={item.createdAt} />
              </span>
            </p>
          </div>
          <Link
            href={`/moderation/approvals/${item.type}/${item.id}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            {t("review")}
          </Link>
        </article>
      )}
    />
  );
}
