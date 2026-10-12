import { SearchX } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { MemberSearch } from "@/app/(main)/members/member-search";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberCard } from "@/components/forum/member-card";
import { TabLinks } from "@/components/forum/tab-links";
import { buttonVariants } from "@/components/ui/button";
import { getUsers, searchMembers, type UserView } from "@/lib/db";
import { cn } from "@/lib/utils";

const SORTS = [
  {
    value: "newest",
    label: "newestLabel",
    compare: (a, b) => b.joinedAt.localeCompare(a.joinedAt),
  },
  {
    value: "posts",
    label: "postsLabel",
    compare: (a, b) => b.postCount - a.postCount,
  },
  {
    value: "level",
    label: "levelLabel",
    compare: (a, b) => b.xp - a.xp,
  },
  {
    value: "reactions",
    label: "reactionsLabel",
    compare: (a, b) => b.reactionCount - a.reactionCount,
  },
] as const satisfies readonly {
  value: string;
  label: string;
  compare: (a: UserView, b: UserView) => number;
}[];

function directoryHref(sort: string, query: string) {
  const params = new URLSearchParams({ view: "all" });
  if (sort !== SORTS[0].value) params.set("sort", sort);
  if (query) params.set("q", query);
  return `/members?${params}`;
}

export async function Directory({
  query,
  sort: sortParam,
}: {
  query: string;
  sort: string;
}) {
  const t = await getTranslations("members.directory");
  const sort = SORTS.find((entry) => entry.value === sortParam) ?? SORTS[0];
  const found = query ? await searchMembers(query) : await getUsers();
  const members = found.toSorted(sort.compare);
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

      <TabLinks
        tabs={SORTS.map(({ value, label }) => ({
          value,
          label: t(label),
          href: directoryHref(value, query),
        }))}
        active={sort.value}
        label={t("aria.sort")}
      />

      {query && members.length > 0 && (
        <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {t.rich("members", {
            count: members.length,
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
      )}

      {members.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {members.map((user) => (
            <MemberCard key={user.id} user={user} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={SearchX}
            title={t("emptyTitle", { query })}
            description={t("emptyDescription")}
          >
            <Link
              href={everyone}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-10 md:h-8",
              )}
            >
              {t("showEveryone")}
            </Link>
          </EmptyState>
        </div>
      )}
    </>
  );
}
