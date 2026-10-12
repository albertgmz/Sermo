import { Search, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserHoverCard } from "@/components/forum/user-hover-card";
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
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Search - forum/ui",
};

const titleLinkClass =
  "text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline";

const ANY_FORUM = { value: "", label: "All forums" };
const ANY_PREFIX = { value: "", label: "Any prefix" };

const selectTriggerClass =
  "w-full data-[size=default]:h-10 md:data-[size=default]:h-8";
const selectItemClass = "min-h-10 md:min-h-8";

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

function ThreadTitle({ thread, href }: { thread: ThreadView; href?: string }) {
  return (
    <h3 className="[overflow-wrap:anywhere]">
      {thread.prefix && (
        <PrefixTag
          prefix={thread.prefix}
          className="mr-1.5 align-[0.0625rem]"
        />
      )}
      <ThreadHoverCard thread={thread} href={href} className={titleLinkClass} />
    </h3>
  );
}

const BEFORE = 60;
const AFTER = 100;

function Excerpt({ body, term }: { body: string; term: string }) {
  const text = body
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
      {start > 0 && "…"}
      {parts}
      {end < text.length && "…"}
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
  const query = first(params.q);
  const member = first(params.member);
  const titlesOnly = first(params.titles) === "1";
  const forum = categories
    .flatMap((category) => category.forums)
    .find((entry) => entry.slug === first(params.forum));
  const prefix = prefixes.find((entry) => entry.key === first(params.prefix));
  const filtered = Boolean(member || titlesOnly || forum || prefix);

  const found = await search(query, viewer?.id ?? null, {
    titlesOnly,
    member: member || undefined,
    forumId: forum?.id,
    prefixId: prefix?.id,
  });
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
    <PageLayout mainClassName="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <search>
        <form
          key={[query, member, titlesOnly, forum?.slug, prefix?.key].join("|")}
          action="/search"
          className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3"
        >
          <div className="space-y-2 sm:col-span-3">
            <Label htmlFor="search-query">Keywords</Label>
            <Input
              id="search-query"
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Search threads, posts and members"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="search-member">By member</Label>
            <Input
              id="search-member"
              name="member"
              defaultValue={member}
              placeholder="Username"
              autoComplete="off"
            />
          </div>
          <div className="space-y-2">
            <Label id="search-forum-label">Forum</Label>
            <Select
              name="forum"
              items={[
                ANY_FORUM,
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
                    {ANY_FORUM.label}
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
            <Label id="search-prefix-label">Prefix</Label>
            <Select
              name="prefix"
              items={[
                ANY_PREFIX,
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
                  {ANY_PREFIX.label}
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
                Search titles only
              </Label>
            </div>
            <Button type="submit" className="h-10 px-4 md:h-8 md:px-3">
              <Search />
              Search
            </Button>
          </div>
        </form>
      </search>

      {hiddenMembers > 0 && (
        <p className="text-sm text-muted-foreground">
          {formatNumber(hiddenMembers)}{" "}
          {hiddenMembers === 1 ? "member matches" : "members match"} “{query}”
          and {hiddenMembers === 1 ? "is" : "are"} not listed while filters are
          on.{" "}
          <Link
            href={`/search?q=${encodeURIComponent(query)}`}
            className="inline-flex min-h-10 items-center font-medium text-foreground underline-offset-4 hover:underline md:min-h-0"
          >
            Search without filters
          </Link>
        </p>
      )}

      {!query ? (
        <EmptyState
          icon={Search}
          title="Search the forum"
          description="Type a word to find matching threads, posts and members, then narrow it down with the filters."
          className="rounded-lg border bg-card"
        />
      ) : total === 0 ? (
        <EmptyState
          icon={SearchX}
          title={`No results for “${query}”`}
          description={
            filtered
              ? "Try a more general term or remove some filters."
              : "Check the spelling or try a shorter, more general term."
          }
          className="rounded-lg border bg-card"
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {formatNumber(total)} {total === 1 ? "result" : "results"} for{" "}
            <span className="font-medium text-foreground [overflow-wrap:anywhere]">
              “{query}”
            </span>
          </p>

          {threads.length > 0 && (
            <SectionCard
              title="Threads"
              action={<Count value={threads.length} />}
            >
              {threads.map((thread) => (
                <article key={thread.id} className="px-4 py-3">
                  <ThreadTitle thread={thread} />
                  <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    <UserHoverCard
                      user={thread.author}
                      className="font-medium"
                    />{" "}
                    in{" "}
                    <Link
                      href={`/forums/${thread.forum.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {thread.forum.title}
                    </Link>{" "}
                    · <RelativeTime date={thread.createdAt} /> ·{" "}
                    {formatNumber(thread.replyCount)}{" "}
                    {thread.replyCount === 1 ? "reply" : "replies"}
                  </p>
                </article>
              ))}
            </SectionCard>
          )}

          {posts.length > 0 && (
            <SectionCard title="Posts" action={<Count value={posts.length} />}>
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
                      <UserHoverCard
                        user={post.author}
                        className="font-medium"
                      />{" "}
                      · Post #{post.number} ·{" "}
                      <RelativeTime date={post.createdAt} />
                    </p>
                    <Excerpt body={post.body} term={query} />
                  </article>
                );
              })}
            </SectionCard>
          )}

          {users.length > 0 && (
            <SectionCard
              title="Members"
              action={<Count value={users.length} />}
            >
              {users.map((user) => (
                <MemberRow key={user.id} user={user}>
                  <UserStats user={user} className="hidden sm:flex" />
                </MemberRow>
              ))}
            </SectionCard>
          )}
        </>
      )}
    </PageLayout>
  );
}
