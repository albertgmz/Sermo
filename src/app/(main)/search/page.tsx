import { Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { PageLayout } from "@/components/layout/page-layout";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getCategories,
  getPrefixes,
  getThread,
  search,
  type ThreadView,
} from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { titleKeyForLevel } from "@/lib/levels";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { liteBlocks } from "@/lib/lite-mode";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("search.search");
  return { title: t("metaTitle") };
}

const titleLinkClass =
  "text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline";

const ANY_FORUM = { value: "", labelKey: "allForums" } as const;
const ANY_PREFIX = { value: "", labelKey: "anyPrefix" } as const;

const selectTriggerClass =
  "w-full data-[size=default]:h-10 md:data-[size=default]:h-8";
const selectItemClass = "min-h-10 md:min-h-8";

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

function ThreadTitle({ thread, href }: { thread: ThreadView; href?: string }) {
  return (
    <h3 className="[overflow-wrap:anywhere]">
      <ThreadHoverCard thread={thread} href={href} className={titleLinkClass} />
    </h3>
  );
}

const BEFORE = 60;
const AFTER = 100;

async function Excerpt({ body, term }: { body: string; term: string }) {
  const source = (await liteBlocks("postImages"))
    ? stripMarkdownImages(body)
    : body;
  const t = await getTranslations("search.search");
  const text = source
    .replace(/[*`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const needle = term.toLowerCase();
  const first = Math.max(0, text.toLowerCase().indexOf(needle));
  const start = Math.max(0, first - BEFORE);
  const end = Math.min(text.length, first + term.length + AFTER);
  const slice = text.slice(start, end);
  const lower = slice.toLowerCase();

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (
    let at = lower.indexOf(needle);
    at !== -1;
    at = lower.indexOf(needle, cursor)
  ) {
    parts.push(
      slice.slice(cursor, at),
      <mark
        key={at}
        className="rounded-sm bg-primary/20 px-0.5 font-medium text-foreground"
      >
        {slice.slice(at, at + term.length)}
      </mark>,
    );
    cursor = at + term.length;
  }
  parts.push(slice.slice(cursor));

  return (
    <p className="mt-1.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
      {start > 0 && t("ellipsis")}
      {parts}
      {end < text.length && t("ellipsis")}
    </p>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="text-xs font-medium tabular-nums text-muted-foreground">
      {formatNumber(value)}
    </span>
  );
}

export default async function SearchPage({
  searchParams,
}: PageProps<"/search">) {
  const [params, viewer, categories, prefixes] = await Promise.all([
    searchParams,
    getCurrentUser(),
    getCategories(),
    getPrefixes(),
  ]);
  const t = await getTranslations("search.search");
  const query = first(params.q);
  const member = first(params.member);
  const titlesOnly = first(params.titles) === "1";
  const forum = categories
    .flatMap((category) => category.forums)
    .find((entry) => entry.slug === first(params.forum));
  const prefix = prefixes.find((entry) => entry.key === first(params.prefix));
  const filtered = Boolean(member || titlesOnly || forum || prefix);

  return (
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <search>
        <form
          key={[query, member, titlesOnly, forum?.slug, prefix?.key].join("|")}
          action="/search"
          className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
        >
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="search-query">{t("keywordsLabel")}</Label>
            <Input
              id="search-query"
              type="search"
              name="q"
              defaultValue={query}
              placeholder={t("keywordsPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="search-member">{t("memberLabel")}</Label>
            <Input
              id="search-member"
              name="member"
              defaultValue={member}
              placeholder={t("memberPlaceholder")}
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label id="search-forum-label">{t("forumLabel")}</Label>
            <Select
              name="forum"
              items={[
                { value: ANY_FORUM.value, label: t(ANY_FORUM.labelKey) },
                ...categories.flatMap((category) =>
                  category.forums.map((entry) => ({
                    value: entry.slug,
                    label: entry.title,
                  })),
                ),
              ]}
              defaultValue={forum?.slug ?? ANY_FORUM.value}
            >
              <SelectTrigger
                aria-labelledby="search-forum-label"
                className={selectTriggerClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    value={ANY_FORUM.value}
                    className={selectItemClass}
                  >
                    {t(ANY_FORUM.labelKey)}
                  </SelectItem>
                </SelectGroup>
                {categories.map((category) => (
                  <SelectGroup key={category.id}>
                    <SelectLabel>{category.title}</SelectLabel>
                    {category.forums.map((entry) => (
                      <SelectItem
                        key={entry.id}
                        value={entry.slug}
                        className={selectItemClass}
                      >
                        {entry.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label id="search-prefix-label">{t("prefixLabel")}</Label>
            <Select
              name="prefix"
              items={[
                { value: ANY_PREFIX.value, label: t(ANY_PREFIX.labelKey) },
                ...prefixes.map((entry) => ({
                  value: entry.key,
                  label: entry.label,
                })),
              ]}
              defaultValue={prefix?.key ?? ANY_PREFIX.value}
            >
              <SelectTrigger
                aria-labelledby="search-prefix-label"
                className={selectTriggerClass}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={ANY_PREFIX.value}
                  className={selectItemClass}
                >
                  {t(ANY_PREFIX.labelKey)}
                </SelectItem>
                {prefixes.map((entry) => (
                  <SelectItem
                    key={entry.id}
                    value={entry.key}
                    label={entry.label}
                    className={selectItemClass}
                  >
                    <PrefixTag prefix={entry} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
            <div className="flex min-h-10 items-center gap-2 md:min-h-8">
              <Checkbox
                id="search-titles"
                name="titles"
                value="1"
                defaultChecked={titlesOnly}
              />
              <Label htmlFor="search-titles" className="font-normal">
                {t("titlesOnlyLabel")}
              </Label>
            </div>
            <Button type="submit" className="h-10 px-4 md:h-8 md:px-3">
              <Search />
              {t("submit")}
            </Button>
          </div>
        </form>
      </search>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingResults")}>
            <CardSkeleton>
              <div className="p-4">
                <TextSkeleton />
              </div>
              <div className="p-4">
                <TextSkeleton />
              </div>
            </CardSkeleton>
          </LoadingRegion>
        }
      >
        <SearchResults
          query={query}
          viewerId={viewer?.id ?? null}
          titlesOnly={titlesOnly}
          member={member}
          forumId={forum?.id}
          prefixId={prefix?.id}
          filtered={filtered}
        />
      </Suspense>
    </PageLayout>
  );
}

async function SearchResults({
  query,
  viewerId,
  titlesOnly,
  member,
  forumId,
  prefixId,
  filtered,
}: {
  query: string;
  viewerId: number | null;
  titlesOnly: boolean;
  member: string;
  forumId?: number;
  prefixId?: number;
  filtered: boolean;
}) {
  const found = await search(query, viewerId, {
    titlesOnly,
    member: member || undefined,
    forumId,
    prefixId,
  });
  const t = await getTranslations("search.search");
  const tLevels = await getTranslations("lib.levels");
  const tRoles = await getTranslations("lib.db.roles");
  const { threads, posts } = found;
  // The filters describe threads and posts, so a filtered search lists no
  // members; a note below the form links to the ones that match.
  const users = filtered ? [] : found.users;
  const hiddenMembers = found.users.length - users.length;
  const total = threads.length + posts.length + users.length;
  const postThreads = new Map(
    await Promise.all(
      [...new Set(posts.map((post) => post.thread.id))].map(
        async (id) => [id, await getThread(id)] as const,
      ),
    ),
  );

  return (
    <>
      {hiddenMembers > 0 && (
        <p className="text-sm text-muted-foreground">
          {t.rich("members", {
            count: hiddenMembers,
            query,
            link: (chunks) => (
              <Link
                href={`/search?q=${encodeURIComponent(query)}`}
                className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline md:min-h-0"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}

      {!query ? (
        <EmptyState
          icon={Search}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          className="rounded-lg border bg-card"
        />
      ) : total === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("noResultsTitle", { query })}
          description={
            filtered ? t("filteredDescription") : t("noResultsDescription")
          }
          className="rounded-lg border bg-card"
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t.rich("results", {
              count: total,
              query,
              term: (chunks) => (
                <span className="font-medium text-foreground [overflow-wrap:anywhere]">
                  {chunks}
                </span>
              ),
            })}
          </p>

          {threads.length > 0 && (
            <SectionCard
              title={t("threadsHeading")}
              action={<Count value={threads.length} />}
            >
              {threads.map((thread) => (
                <article key={thread.id} className="px-4 py-3">
                  <ThreadTitle thread={thread} />
                  <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {t.rich("replies", {
                      count: thread.replyCount,
                      author: () => (
                        <UserLink
                          user={thread.author}
                          className="font-medium"
                        />
                      ),
                      forum: () => (
                        <Link
                          href={`/forums/${thread.forum.id}`}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {thread.forum.title}
                        </Link>
                      ),
                      time: () => <RelativeTime date={thread.createdAt} />,
                    })}
                  </p>
                </article>
              ))}
            </SectionCard>
          )}

          {posts.length > 0 && (
            <SectionCard
              title={t("postsHeading")}
              action={<Count value={posts.length} />}
            >
              {posts.map((post) => {
                const thread = postThreads.get(post.thread.id);
                return (
                  <article key={post.id} className="px-4 py-3">
                    {thread && (
                      <ThreadTitle
                        thread={thread}
                        href={`/threads/${thread.id}#post-${post.id}`}
                      />
                    )}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t.rich("postDetails", {
                        number: formatNumber(post.number),
                        author: () => (
                          <UserLink
                            user={post.author}
                            className="font-medium"
                          />
                        ),
                        time: () => <RelativeTime date={post.createdAt} />,
                      })}
                    </p>
                    <Excerpt body={post.body} term={query} />
                  </article>
                );
              })}
            </SectionCard>
          )}

          {users.length > 0 && (
            <SectionCard
              title={t("membersHeading")}
              action={<Count value={users.length} />}
            >
              {users.map((user) => (
                <MemberRow
                  key={user.id}
                  user={{
                    ...user,
                    title:
                      (can(user, "customTitle") && user.customTitle) ||
                      (user.role === "member"
                        ? tLevels(titleKeyForLevel(user.level.level))
                        : tRoles(user.role)),
                  }}
                >
                  <UserStats user={user} className="hidden sm:flex" />
                </MemberRow>
              ))}
            </SectionCard>
          )}
        </>
      )}
    </>
  );
}
