import { searchQuery, type usersSearch } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserLink } from "@/components/forum/user-link";
import type { ListPage } from "@/lib/list-pages";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { membersFor } from "@/lib/sermo/members";
import { threadOpenHref } from "@/lib/sermo/open-links";
import { getViewer } from "@/lib/sermo/session";
import type { Filters } from "./filters";

export type MemberMatch = z.output<typeof usersSearch.output>["items"][number];

const titleLinkClass =
  "inline-flex min-h-10 items-center text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline md:min-h-0";

// A refusal of the backend (a query too short or too long, a stale cursor, a visitor who may not
// search) is shown as it is worded; a failure of the backend itself is not ours to hide.
export async function refusal<T>(
  pending: Promise<T>,
): Promise<{ value: T } | { message: string; code: string; status: number }> {
  try {
    return { value: await pending };
  } catch (error) {
    if (!(error instanceof SermoError) || error.status >= 500) throw error;
    return {
      message: await errorMessage(error),
      code: error.code,
      status: error.status,
    };
  }
}

// One page of search results, drawn: the results' first page and each page the browser asks for.
// A result that is a reply opens that post; one that is a thread's first post opens the thread
// where the member left off.
// `matches` are the members the first page also shows; their cards come from the same lookup as
// the authors' ones.
export async function searchPage(
  filters: Filters,
  authorId: number | undefined,
  cursor: string | undefined,
  matches: Promise<MemberMatch[]> = Promise.resolve([]),
) {
  const t = await getTranslations("search.search");
  const [found, matched, viewer] = await Promise.all([
    refusal(
      call(searchQuery, {
        q: filters.query,
        titlesOnly: filters.titlesOnly,
        nodeId: filters.forum,
        prefixId: filters.prefix,
        authorId,
        cursor,
      }),
    ),
    matches,
    getViewer(),
  ]);
  if ("message" in found) return found;
  const { items, nextCursor } = found.value;
  const signedIn = viewer.user !== null;
  const member = await membersFor([
    ...items.map(({ post }) => post.author),
    ...matched,
  ]);
  const page: ListPage = {
    nextCursor,
    rows: items.map(({ post, thread }) => ({
      key: String(post.id),
      node: (
        <article className="px-4 py-3">
          <h3 className="flex flex-wrap items-center gap-x-2">
            {thread.prefix && <PrefixTag prefix={thread.prefix} />}
            <Link
              href={
                post.position === 0
                  ? threadOpenHref(thread.id, signedIn)
                  : threadHref(thread.id, post.position, post.id)
              }
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
      ),
    })),
  };
  return { page, member, matches: matched };
}
