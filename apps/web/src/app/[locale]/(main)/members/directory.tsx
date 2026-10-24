import { usersSearch } from "@sermo/core/contracts";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  DirectoryPages,
  directoryPage,
  directoryParams,
} from "@/app/[locale]/(main)/members/directory-page";
import { MemberSearch } from "@/app/[locale]/(main)/members/member-search";
import { directoryPageAction } from "@/app/[locale]/(main)/members/members-page-actions";
import { MEMBERS_PATH } from "@/app/[locale]/(main)/members/ranking-page";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { MemberRow } from "@/components/forum/member-row";
import { PageSwitch } from "@/components/forum/page-switch";
import { pageAddress, pagesOf } from "@/components/forum/page-window";
import { SectionCard } from "@/components/forum/section-card";
import { TabLinks } from "@/components/forum/tab-links";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { MEMBERS_PER_PAGE } from "@/lib/sermo/page-sizes";
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
  page,
}: {
  sort: (typeof SORTS)[number]["value"];
  page: number;
}) {
  const first = await directoryPage(sort, page);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(first.total, MEMBERS_PER_PAGE);
  if (page > pages)
    redirect(pageAddress(MEMBERS_PATH, directoryParams(sort), pages));
  return (
    <PageSwitch
      page={page}
      stamp={Date.now()}
      load={directoryPageAction.bind(null, sort)}
    >
      <DirectoryPages sort={sort} page={page} list={first} />
    </PageSwitch>
  );
}

export async function Directory({
  query,
  sort: sortParam,
  page,
}: {
  query: string;
  sort: string;
  page: number;
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
          <Everyone sort={sort.value} page={page} />
        </>
      )}
    </>
  );
}
