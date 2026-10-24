import { postsByAuthor, threadsByAuthor } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { ClampedBody } from "@/app/[locale]/(main)/_feed/clamped-body";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { HtmlContent } from "@/components/forum/html-content";
import { PrefixTag } from "@/components/forum/prefix-tag";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { threadOpenHref } from "@/lib/sermo/open-links";
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

// One page of a member's posts, drawn: the tab's first page and each page the browser asks for.
export async function postsPage(
  userId: number,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [{ items, nextCursor }, t, format] = await Promise.all([
    reader(postsByAuthor, { userId, cursor }),
    getTranslations("members.profile"),
    getFormatter(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return {
    nextCursor,
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

// One page of a member's threads, drawn.
export async function threadsPage(
  userId: number,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [{ items, nextCursor }, t, format, viewer] = await Promise.all([
    reader(threadsByAuthor, { userId, cursor }),
    getTranslations("members.profile"),
    getFormatter(),
    getViewer(),
  ]);
  // The clock is read after the request data.
  const now = await getNow();
  return {
    nextCursor,
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
