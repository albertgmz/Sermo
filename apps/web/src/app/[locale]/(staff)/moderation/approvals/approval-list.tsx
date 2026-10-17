import { approvalsList } from "@sermo/core/contracts";
import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { cursorFrom } from "@/components/staff/cursor-list";
import { RowLink } from "@/components/staff/item-list";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { MemberLink, memberNames } from "../../admin/logs/links";
import { FilterBar, first, forumOptions } from "../filter-bar";
import { QueueList } from "../queue-list";
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
    <QueueList
      items={page.items.map((item) => ({
        id: `${item.type}-${item.id}`,
        title: (
          <span className="line-clamp-2">
            {item.excerpt || `${type(item.type)} #${item.id}`}
          </span>
        ),
        href: `/moderation/approvals/${item.type}/${item.id}`,
        badges: <Badge variant="secondary">{type(item.type)}</Badge>,
        description: (
          <p className="flex flex-wrap items-center gap-x-3">
            <QueuePlace where={item.where} />
            <MemberLink id={item.authorId} name={name(item.authorId)} />
            <span>
              {t("added")} <RelativeTime date={item.createdAt} />
            </span>
          </p>
        ),
        actions: (
          <RowLink
            href={`/moderation/approvals/${item.type}/${item.id}`}
            label={t("review")}
            icon={<Eye />}
          />
        ),
      }))}
      nextCursor={page.nextCursor}
      path="/moderation/approvals"
      params={params}
      label={t("list")}
      empty={{ title: t("emptyTitle"), description: t("emptyDescription") }}
      filters={
        <FilterBar
          path="/moderation/approvals"
          params={params}
          forums={forums}
        />
      }
    />
  );
}
