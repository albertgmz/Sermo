import { usersList, usersSearch } from "@sermo/core/contracts";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MemberSearch } from "@/app/(main)/members/member-search";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { LoadMore } from "@/components/forum/load-more";
import { MemberCard } from "@/components/forum/member-card";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import { TabLinks } from "@/components/forum/tab-links";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";

// The sorts of the directory, in the order of its tabs; the backend does the sorting.
const SORTS = [
  { value: "newest", label: "newestLabel" },
  { value: "posts", label: "postsLabel" },
  { value: "level", label: "levelLabel" },
  { value: "reactions", label: "reactionsLabel" },
] as const;

function directoryHref(sort: string, query: string) {
  const params = new URLSearchParams({ view: "all" });
  if (sort !== SORTS[0].value) params.set("sort", sort);
  if (query) params.set("q", query);
  return `/members?${params}`;
}

async function Found({ query, everyone }: { query: string; everyone: string }) {
  const t = await getTranslations("members.directory");
  // The backend finds usernames that start with the text, at most 25.
  const { items } = await read(usersSearch, { prefix: query });
  const member = await membersFor(items);
  return items.length > 0 ? (
    <>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {t.rich("members", {
          count: items.length,
          query,
          link: (chunks) => (
            <Link
              href={everyone}
              className="relative font-medium text-foreground underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-2.5 hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
      <SectionCard title={t("resultsHeading")}>
        {items.map((item) => {
          const found = member(item.id);
          return (
            <MemberRow key={item.id} user={found} badgeLimit={1}>
              <LevelBadge level={found} />
            </MemberRow>
          );
        })}
      </SectionCard>
    </>
  ) : (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={SearchX}
        title={t("emptyTitle", { query })}
        description={t("emptyDescription")}
      >
        <Link
          href={everyone}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 md:h-8")}
        >
          {t("showEveryone")}
        </Link>
      </EmptyState>
    </div>
  );
}

async function Everyone({
  sort,
  cursor,
}: {
  sort: (typeof SORTS)[number]["value"];
  cursor?: string;
}) {
  const [{ items, nextCursor }, loadMore] = await Promise.all([
    read(usersList, { sort, cursor }),
    getTranslations("members.loadMore"),
  ]);
  const params = new URLSearchParams({ view: "all" });
  if (sort !== SORTS[0].value) params.set("sort", sort);
  if (nextCursor) params.set("cursor", nextCursor);
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <MemberCard key={item.card.id} user={item} />
        ))}
      </div>
      {nextCursor && (
        <LoadMore href={`/members?${params}`}>{loadMore("label")}</LoadMore>
      )}
    </>
  );
}

export async function Directory({
  query,
  sort: sortParam,
  cursor,
}: {
  query: string;
  sort: string;
  cursor?: string;
}) {
  const t = await getTranslations("members.directory");
  const sort = SORTS.find((entry) => entry.value === sortParam) ?? SORTS[0];
  const everyone = directoryHref(sort.value, "");

  return (
    <>
      <div className="rounded-lg border bg-card p-3">
        <MemberSearch
          id="directory-search"
          query={query}
          sort={sort === SORTS[0] ? undefined : sort.value}
        />
      </div>

      {query ? (
        <Found query={query} everyone={everyone} />
      ) : (
        <>
          <TabLinks
            tabs={SORTS.map(({ value, label }) => ({
              value,
              label: t(label),
              href: directoryHref(value, query),
            }))}
            active={sort.value}
            label={t("aria.sort")}
          />
          <Everyone sort={sort.value} cursor={cursor} />
        </>
      )}
    </>
  );
}
