import { postsByAuthor, threadsByAuthor } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ClampedBody } from "@/app/[locale]/(main)/_feed/clamped-body";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { HtmlContent } from "@/components/forum/html-content";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import { PrefixTag } from "@/components/forum/prefix-tag";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { threadOpenHref } from "@/lib/sermo/open-links";
import {
  AUTHOR_POSTS_PER_PAGE,
  AUTHOR_THREADS_PER_PAGE,
} from "@/lib/sermo/page-sizes";
import { getViewer } from "@/lib/sermo/session";
import { prefixView } from "@/lib/sermo/threads";

const titleLinkClass =
  "text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline";

// About what fits in the clamped box on a phone.
const CLAMP_LENGTH = 440;

function looksLong(html: string) {
  return html.replace(/<[^>]*>/g, "").length > CLAMP_LENGTH;
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

export type ActivityKind = "posts" | "threads";

// One numbered page of a tab's list, drawn, and how many items the numbered pages hold.
export type ActivityPage = { rows: ListRow[]; total: number };

// One numbered page of a member's posts, drawn.
export async function postsPage(
  userId: number,
  page: number,
  reader: typeof read = read,
): Promise<ActivityPage> {
  const [{ items, total }, t, format] = await Promise.all([
    reader(postsByAuthor, { userId, page }),
    getTranslations("members.profile"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return {
    total: total ?? 0,
    rows: items.map(({ post, thread }) => {
      const href = threadHref(thread.id, post.position, post.id);
      return {
        key: String(post.id),
        node: (
          <article className="px-4 py-3">
            <ActivityTitle href={href} prefix={prefixView(thread.prefix)}>
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
        ),
      };
    }),
  };
}

// One numbered page of a member's threads, drawn.
export async function threadsPage(
  userId: number,
  page: number,
  reader: typeof read = read,
): Promise<ActivityPage> {
  const [{ items, total }, t, format, viewer] = await Promise.all([
    reader(threadsByAuthor, { userId, page }),
    getTranslations("members.profile"),
    getFormatter(),
    getViewer(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return {
    total: total ?? 0,
    rows: items.map((thread) => ({
      key: String(thread.id),
      node: (
        <article className="px-4 py-3">
          <ActivityTitle
            href={threadOpenHref(thread.id, viewer.user !== null)}
            prefix={prefixView(thread.prefix)}
          >
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
      ),
    })),
  };
}

export const activityPage = (
  kind: ActivityKind,
  userId: number,
  page: number,
  reader: typeof read = read,
) =>
  kind === "posts"
    ? postsPage(userId, page, reader)
    : threadsPage(userId, page, reader);

// The address of a tab's list: the profile, and the tab.
export function activityAddress(kind: ActivityKind, userId: number) {
  return { path: `/members/${userId}`, params: { tab: kind } };
}

export const activityPages = (kind: ActivityKind, total: number) =>
  pagesOf(
    total,
    kind === "posts" ? AUTHOR_POSTS_PER_PAGE : AUTHOR_THREADS_PER_PAGE,
  );

// The part of a profile's posts or threads tab that turns with its pages (`PageSwitch`): the
// pagers and the card of rows, with the heading only a screen reader sees.
export function ActivityPages({
  kind,
  userId,
  page,
  list,
}: {
  kind: ActivityKind;
  userId: number;
  page: number;
  list: ActivityPage;
}) {
  const t = useTranslations("members.profile");
  return (
    <NumberedList
      page={page}
      pages={activityPages(kind, list.total)}
      {...activityAddress(kind, userId)}
      rows={list.rows}
      header={<h2 className="sr-only">{t(`${kind}Tab`)}</h2>}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
