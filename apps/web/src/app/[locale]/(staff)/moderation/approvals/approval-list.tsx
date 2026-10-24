import { approvalsList } from "@sermo/core/contracts";
import { Eye } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { RelativeTime } from "@/components/forum/relative-time";
import { cursorFrom } from "@/components/staff/cursor-list";
import { RowLink } from "@/components/staff/item-list";
import { PagedList } from "@/components/staff/paged-list";
import { Badge } from "@/components/ui/badge";
import { authorName, memberIdOf } from "@/lib/sermo/authors";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
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
  const name = await memberNames(
    page.items.flatMap((item) => memberIdOf(item.author) ?? []),
  );
  return (
    <PagedList
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
            {item.author.kind === "member" ? (
              <MemberLink id={item.author.id} name={name(item.author.id)} />
            ) : (
              <span>{authorName(item.author)}</span>
            )}
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
      paging={{
        path: "/moderation/approvals",
        params,
        nextCursor: page.nextCursor,
      }}
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
