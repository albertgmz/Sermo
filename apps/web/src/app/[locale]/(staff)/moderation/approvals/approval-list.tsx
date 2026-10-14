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
import { FilterBar, first, forumOptions } from "../filter-bar";
import { QueuePlace } from "../where";

type Params = PageProps<"/[locale]/moderation/approvals">["searchParams"];

// The approval queue as the backend returns it for this viewer. Each row carries the kind, the id,
// the author, the time, an excerpt of the content and the place it is in: nothing is read per row.
export async function ApprovalList({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const nodeId = parseId(first(params.nodeId)) ?? undefined;
  const [t, type, forums, page] = await Promise.all([
    getTranslations("moderation.approvals"),
    getTranslations("moderation.common.type"),
    forumOptions({ moderated: true }),
    read(approvalsList, { nodeId, cursor: cursorFrom(params), limit: 20 }),
  ]);
  const name = await memberNames(page.items.map((item) => item.authorId));
  return (
    <CursorList
      items={page.items}
      nextCursor={page.nextCursor}
      path="/moderation/approvals"
      params={params}
      itemKey={(item) => `${item.type}-${item.id}`}
      label={t("list")}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      filters={
        <FilterBar
          path="/moderation/approvals"
          params={params}
          forums={forums}
        />
      }
      render={(item) => (
        <article className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{type(item.type)}</Badge>
            </p>
            {item.excerpt && (
              <p className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                {item.excerpt}
              </p>
            )}
            <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <QueuePlace where={item.where} />
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
