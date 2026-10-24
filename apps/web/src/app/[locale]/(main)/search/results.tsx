import { usersSearch } from "@sermo/core/contracts";
import { Search, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { MemberRow } from "@/components/forum/member-row";
import { PageSwitch } from "@/components/forum/page-switch";
import { pageAddress, pagesOf } from "@/components/forum/page-window";
import { SectionCard } from "@/components/forum/section-card";
import { call } from "@/lib/sermo/client";
import { SEARCH_RESULTS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { cn } from "@/lib/utils";
import { type Filters, SEARCH_PATH, searchHref, searchParams } from "./filters";
import { refusal, SearchPages, searchPage } from "./search-page";
import { searchPageAction } from "./search-page-action";

const card = "rounded-lg border bg-card";

// The member the visitor typed: the backend finds usernames by their start, the exact one is ours
// to pick.
async function authorId(username: string) {
  if (username.length > 32) return undefined;
  const { items } = await call(usersSearch, { prefix: username, limit: 25 });
  const wanted = username.toLowerCase();
  return items.find((item) => item.username.toLowerCase() === wanted)?.id;
}

// Members whose username starts with the query: a single word, without filters.
function memberPrefix({ query, titlesOnly, forum, prefix, author }: Filters) {
  const unfiltered = !titlesOnly && !forum && !prefix && !author;
  return unfiltered && /^\S{1,32}$/.test(query) ? query : undefined;
}

export async function Results({
  filters,
  page,
}: {
  filters: Filters;
  page: number;
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

  const startsWith = memberPrefix(filters);
  const matches =
    startsWith === undefined
      ? undefined
      : refusal(call(usersSearch, { prefix: startsWith })).then((answer) =>
          "value" in answer ? answer.value.items : [],
        );
  const found = await searchPage(filters, wanted, page, matches);

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
          {page > 1 && (
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

  const { results, member, matches: matched } = found;
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(results.total, SEARCH_RESULTS_PER_PAGE);
  if (page > pages)
    redirect(pageAddress(SEARCH_PATH, searchParams(filters), pages));

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

      {results.total === 0 ? (
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
        <PageSwitch
          page={page}
          stamp={Date.now()}
          load={searchPageAction.bind(null, filters, wanted)}
        >
          <SearchPages filters={filters} page={page} list={results} />
        </PageSwitch>
      )}
    </>
  );
}
