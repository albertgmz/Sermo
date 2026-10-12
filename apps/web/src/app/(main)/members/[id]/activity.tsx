import { postsByAuthor, threadsByAuthor } from "@sermo/core/contracts";
import { MessagesSquare } from "lucide-react";
import Link from "next/link";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import { ClampedBody } from "@/app/(main)/_feed/clamped-body";
import type { Profile } from "@/app/(main)/members/[id]/profile";
import { LoadMore } from "@/app/(main)/members/load-more";
import { threadHref } from "@/app/(main)/threads/[id]/pages";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
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

export async function PostsTab({
  profile,
  cursor,
}: {
  profile: Profile;
  cursor?: string;
}) {
  const [{ items, nextCursor }, t, format] = await Promise.all([
    read(postsByAuthor, { userId: profile.id, cursor }),
    getTranslations("members.profile"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return (
    <section className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{t("postsTab")}</h2>
      {items.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={t("postsEmptyTitle")}
          description={t.rich("postsEmptyDescription", {
            username: profile.username,
            user: () => <UserLink user={profile.card} />,
          })}
        />
      ) : (
        items.map(({ post, thread }) => {
          const href = threadHref(thread.id, post.position, post.id);
          const prefix = prefixView(thread.prefix);
          return (
            <article key={post.id} className="px-4 py-3">
              <h3>
                <Link href={href} className={titleLinkClass}>
                  {prefix && (
                    <PrefixTag
                      prefix={prefix}
                      className="mr-1.5 align-(--prefix-offset)"
                    />
                  )}
                  {thread.title}
                </Link>
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("postDetails", {
                  number: post.position + 1,
                  time: format.relativeTime(new Date(post.createdAt), now),
                })}
              </p>
              <ClampedBody href={href} expectLong={looksLong(post.bodyHtml)}>
                <HtmlContent className="text-muted-foreground">
                  {post.bodyHtml}
                </HtmlContent>
              </ClampedBody>
            </article>
          );
        })
      )}
      {nextCursor && (
        <div className="p-3">
          <LoadMore href={tabHref(profile.id, "posts", nextCursor)} />
        </div>
      )}
    </section>
  );
}

export async function ThreadsTab({
  profile,
  cursor,
}: {
  profile: Profile;
  cursor?: string;
}) {
  const [{ items, nextCursor }, t, format] = await Promise.all([
    read(threadsByAuthor, { userId: profile.id, cursor }),
    getTranslations("members.profile"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return (
    <section className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
      <h2 className="sr-only">{t("threadsTab")}</h2>
      {items.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title={t("threadsEmptyTitle")}
          description={t.rich("threadsEmptyDescription", {
            username: profile.username,
            user: () => <UserLink user={profile.card} />,
          })}
        />
      ) : (
        items.map((thread) => {
          const prefix = prefixView(thread.prefix);
          return (
            <article key={thread.id} className="px-4 py-3">
              <h3>
                <Link href={`/threads/${thread.id}`} className={titleLinkClass}>
                  {prefix && (
                    <PrefixTag
                      prefix={prefix}
                      className="mr-1.5 align-(--prefix-offset)"
                    />
                  )}
                  {thread.title}
                </Link>
              </h3>
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
        })
      )}
      {nextCursor && (
        <div className="p-3">
          <LoadMore href={tabHref(profile.id, "threads", nextCursor)} />
        </div>
      )}
    </section>
  );
}
