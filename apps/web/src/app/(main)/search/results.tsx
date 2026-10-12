import { searchQuery, usersSearch } from "@sermo/core/contracts";
import { ChevronDown, Search, SearchX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { UserLink } from "@/components/forum/user-link";
import { buttonVariants } from "@/components/ui/button";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor } from "@/lib/sermo/members";
import { cn } from "@/lib/utils";
import { type Filters, searchHref } from "./filters";

const card = "rounded-lg border bg-card";

const titleLinkClass =
  "inline-flex min-h-10 items-center text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline md:min-h-0";

// A refusal of the backend (a query too short or too long, a stale cursor, a visitor who may not
// search) is shown as it is worded; a failure of the backend itself is not ours to hide.
async function refusal<T>(
  pending: Promise<T>,
): Promise<{ value: T } | { message: string }> {
  try {
    return { value: await pending };
  } catch (error) {
    if (!(error instanceof SermoError) || error.status >= 500) throw error;
    return { message: errorMessage(error) };
  }
}

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
}: {
  filters: Filters;
  cursor?: string;
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
  const [found, matches] = await Promise.all([
    refusal(
      call(searchQuery, {
        q: query,
        titlesOnly,
        nodeId: forum,
        prefixId: prefix,
        authorId: wanted,
        cursor,
      }),
    ),
    startsWith === undefined
      ? { items: [] }
      : refusal(call(usersSearch, { prefix: startsWith })).then((answer) =>
          "value" in answer ? answer.value : { items: [] },
        ),
  ]);

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

  const { items, nextCursor } = found.value;
  const member = await membersFor([
    ...items.map(({ post }) => post.author),
    ...matches.items,
  ]);

  return (
    <>
      {matches.items.length > 0 && (
        <SectionCard
          title={t("membersHeading")}
          description={t("membersDescription", { query: startsWith ?? "" })}
        >
          {matches.items.map((item) => {
            const matched = member(item.id);
            return (
              <MemberRow key={item.id} user={matched} badgeLimit={1}>
                <LevelBadge level={matched} />
              </MemberRow>
            );
          })}
        </SectionCard>
      )}

      {items.length === 0 ? (
        // A page may be short, or empty, while the backend still has more to look through.
        nextCursor ? null : (
          <EmptyState
            icon={SearchX}
            title={t("noResultsTitle", { query })}
            description={
              titlesOnly || forum || prefix || author
                ? t("filteredDescription")
                : t("noResultsDescription")
            }
            className={card}
          />
        )
      ) : (
        <SectionCard title={t("postsHeading")}>
          {items.map(({ post, thread }) => (
            <article key={post.id} className="px-4 py-3">
              <h3 className="flex flex-wrap items-center gap-x-2">
                {thread.prefix && <PrefixTag prefix={thread.prefix} />}
                <Link
                  href={threadHref(thread.id, post.position, post.id)}
                  className={titleLinkClass}
                >
                  {thread.title}
                </Link>
              </h3>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {t.rich("details", {
                  number: post.position + 1,
                  author: () => (
                    <UserLink
                      user={member(post.author.id)}
                      className="font-medium"
                    />
                  ),
                  forum: () => (
                    <Link
                      href={`/forums/${thread.node.id}`}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {thread.node.title}
                    </Link>
                  ),
                  time: () => <RelativeTime date={post.createdAt} />,
                })}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {post.excerpt}
              </p>
            </article>
          ))}
        </SectionCard>
      )}

      {nextCursor && (
        <Link
          href={searchHref(filters, nextCursor)}
          scroll={false}
          className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
        >
          <ChevronDown />
          {t("loadMore")}
        </Link>
      )}
    </>
  );
}
