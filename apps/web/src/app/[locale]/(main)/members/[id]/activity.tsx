import { postsByAuthor, threadsByAuthor } from "@sermo/core/contracts";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ClampedBody } from "@/app/[locale]/(main)/_feed/clamped-body";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { LoadMore } from "@/components/forum/load-more";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { UserLink } from "@/components/forum/user-link";
import { read } from "@/lib/sermo/client";
import { prefixView } from "@/lib/sermo/threads";

const titleLinkClass =
  "text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline";

// About what fits in the clamped box on a phone.
const CLAMP_LENGTH = 440;

function tabHref(profileId: number, tab: string, cursor: string) {
  return `/members/${profileId}?tab=${tab}&cursor=${encodeURIComponent(cursor)}`;
}

function looksLong(html: string) {
  return html.replace(/<[^>]*>/g, "").length > CLAMP_LENGTH;
}

// A tab's list: a card with the heading only a screen reader sees, the rows or the empty state, and
// the link to the next page when there is one.
function ActivityList({
  heading,
  empty,
  more,
  children,
}: {
  heading: string;
  empty: { title: string; description: ReactNode } | null;
  more: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{heading}</h2>
      {empty ? (
        <EmptyState
          icon={MessagesSquare}
          title={empty.title}
          description={empty.description}
        />
      ) : (
        children
      )}
      {more && <div className="p-3">{more}</div>}
    </section>
  );
}

// The thread's title as a link, with its prefix.
function ActivityTitle({
  href,
  prefix,
  children,
}: {
  href: string;
  prefix: ReturnType<typeof prefixView>;
  children: ReactNode;
}) {
  return (
    <h3>
      <Link href={href} className={titleLinkClass}>
        {prefix && (
          <PrefixTag
            prefix={prefix}
            className="mr-1.5 align-(--prefix-offset)"
          />
        )}
        {children}
      </Link>
    </h3>
  );
}

export async function PostsTab({
  profile,
  cursor,
}: {
  profile: Profile;
  cursor?: string;
}) {
  const [{ items, nextCursor }, t, loadMore, format] = await Promise.all([
    read(postsByAuthor, { userId: profile.id, cursor }),
    getTranslations("members.profile"),
    getTranslations("members.loadMore"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return (
    <ActivityList
      heading={t("postsTab")}
      empty={
        items.length === 0
          ? {
              title: t("postsEmptyTitle"),
              description: t.rich("postsEmptyDescription", {
                username: profile.username,
                user: () => <UserLink user={profile.card} />,
              }),
            }
          : null
      }
      more={
        nextCursor && (
          <LoadMore href={tabHref(profile.id, "posts", nextCursor)}>
            {loadMore("label")}
          </LoadMore>
        )
      }
    >
      {items.map(({ post, thread }) => {
        const href = threadHref(thread.id, post.position, post.id);
        const prefix = prefixView(thread.prefix);
        return (
          <article key={post.id} className="px-4 py-3">
            <ActivityTitle href={href} prefix={prefix}>
              {thread.title}
            </ActivityTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("postDetails", {
                number: post.position + 1,
                time: format.relativeTime(new Date(post.createdAt), now),
              })}
            </p>
            <ClampedBody href={href} expectLong={looksLong(post.bodyHtml)}>
              <HtmlContent
                className="text-muted-foreground"
                content={{ type: "post", id: post.id }}
              >
                {post.bodyHtml}
              </HtmlContent>
            </ClampedBody>
          </article>
        );
      })}
    </ActivityList>
  );
}

export async function ThreadsTab({
  profile,
  cursor,
}: {
  profile: Profile;
  cursor?: string;
}) {
  const [{ items, nextCursor }, t, loadMore, format] = await Promise.all([
    read(threadsByAuthor, { userId: profile.id, cursor }),
    getTranslations("members.profile"),
    getTranslations("members.loadMore"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return (
    <ActivityList
      heading={t("threadsTab")}
      empty={
        items.length === 0
          ? {
              title: t("threadsEmptyTitle"),
              description: t.rich("threadsEmptyDescription", {
                username: profile.username,
                user: () => <UserLink user={profile.card} />,
              }),
            }
          : null
      }
      more={
        nextCursor && (
          <LoadMore href={tabHref(profile.id, "threads", nextCursor)}>
            {loadMore("label")}
          </LoadMore>
        )
      }
    >
      {items.map((thread) => {
        const prefix = prefixView(thread.prefix);
        return (
          <article key={thread.id} className="px-4 py-3">
            <ActivityTitle href={`/threads/${thread.id}`} prefix={prefix}>
              {thread.title}
            </ActivityTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.rich("threadDetails", {
                title: thread.node.title,
                time: format.relativeTime(new Date(thread.createdAt), now),
                replies: t("replies", { count: thread.replyCount }),
                views: t("views", { count: thread.viewCount }),
                forum: (chunks) => (
                  <Link
                    href={`/forums/${thread.node.id}`}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          </article>
        );
      })}
    </ActivityList>
  );
}
