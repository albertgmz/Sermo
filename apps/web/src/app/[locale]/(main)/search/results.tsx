import { usersSearch } from "@sermo/core/contracts";
import { Search, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { MemberRow } from "@/components/forum/member-row";
import { PagedList } from "@/components/forum/paged-list";
import { SectionCard, SectionHeader } from "@/components/forum/section-card";
import { call } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";
import { type Filters, searchHref } from "./filters";
import { moreResults } from "./more-results";
import { refusal, searchPage } from "./search-page";

const card = "rounded-lg border bg-card";

// A search is the backend's costliest and most limited read (30 a minute per visitor, and each
// page also looks up its members), so an address that asks for more pages gets two.
const RESTORED_PAGES = 2;

// The member the visitor typed: the backend finds usernames by their start, the exact one is ours
// to pick.
async function authorId(username: string) {
  if (username.length > 32) return undefined;
  const { items } = await call(usersSearch, { prefix: username, limit: 25 });
  const wanted = username.toLowerCase();
  return items.find((item) => item.username.toLowerCase() === wanted)?.id;
}

// Members whose username starts with the query: a single word, on the first page, without filters.
function memberPrefix({ query, titlesOnly, forum, prefix, author }: Filters) {
  const unfiltered = !titlesOnly && !forum && !prefix && !author;
  return unfiltered && /^\S{1,32}$/.test(query) ? query : undefined;
}

export async function Results({
  filters,
  cursor,
  pages,
}: {
  filters: Filters;
  cursor?: string;
  // How many pages the address asks for.
  pages: number;
}) {
  const t = await getTranslations("search.search");
  const { query, titlesOnly, forum, prefix, author } = filters;

  if (!query) {
    return (
      <EmptyState
        icon={Search}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        className={card}
      />
    );
  }

  const wanted = author ? await authorId(author) : undefined;
  if (author && wanted === undefined) {
    return (
      <EmptyState
        icon={SearchX}
        title={t("noAuthorTitle", { author })}
        description={t("noAuthorDescription")}
        className={card}
      />
    );
  }

  const startsWith = cursor ? undefined : memberPrefix(filters);
  const matches =
    startsWith === undefined
      ? undefined
      : refusal(call(usersSearch, { prefix: startsWith })).then((answer) =>
          "value" in answer ? answer.value.items : [],
        );
  const found = await searchPage(filters, wanted, cursor, matches);

  if ("message" in found) {
    return (
      <div
        role="alert"
        className={cn(card, "flex items-start gap-3 p-4 text-sm")}
      >
        <TriangleAlert
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-destructive"
        />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{t("refusedTitle")}</p>
          <p className="text-muted-foreground [overflow-wrap:anywhere]">
            {found.message}
          </p>
          {cursor && (
            <Link
              href={searchHref(filters)}
              className="inline-flex min-h-10 items-center font-medium underline-offset-4 hover:underline md:min-h-0"
            >
              {t("fromStart")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const { page, member, matches: matched } = found;
  const listed = page.rows.length > 0;

  return (
    <>
      {matched.length > 0 && (
        <SectionCard
          title={t("membersHeading")}
          description={t("membersDescription", { query: startsWith ?? "" })}
        >
          {matched.map((item) => {
            const matchedMember = member(item.id);
            return (
              <MemberRow key={item.id} user={matchedMember} badgeLimit={1}>
                <LevelBadge level={matchedMember} />
              </MemberRow>
            );
          })}
        </SectionCard>
      )}

      {!listed && !page.nextCursor ? (
        <EmptyState
          icon={SearchX}
          title={t(matched.length > 0 ? "noPostsTitle" : "noResultsTitle", {
            query,
          })}
          description={
            titlesOnly || forum || prefix || author
              ? t("filteredDescription")
              : t("noResultsDescription")
          }
          className={card}
        />
      ) : (
        // A page may be short, or empty, while the backend still has more to look through.
        <PagedList
          first={page}
          more={moreResults.bind(null, filters, wanted)}
          pages={Math.min(pages, RESTORED_PAGES)}
          start={cursor}
          listKey={["search", searchHref(filters)]}
          hrefBase={searchHref(filters)}
          moreLabel={t("loadMore")}
          estimateSize={120}
          className={card}
          header={<SectionHeader title={t("postsHeading")} />}
        />
      )}
    </>
  );
}
