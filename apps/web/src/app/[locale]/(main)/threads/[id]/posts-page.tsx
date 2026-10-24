"use server";

import { threadsGet } from "@sermo/core/contracts";
import type { ReactNode } from "react";
import {
  PostsRegion,
  postsContext,
  readPosts,
} from "@/app/[locale]/(main)/threads/[id]/thread-posts";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { requireIds } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";

// A page of a thread's posts, drawn as the thread page draws it, for the pager that turns the
// pages in place (`PageSwitch`). The thread is read again, as a page load reads it (a view is
// counted, as XenForo counts one per page): what the viewer may see and do there is the backend's
// answer of now, never what the browser sends. Null when there is nothing to show in place (the
// thread moved by a merge, its posts are closed to the viewer, the page is empty, the backend
// refuses): the browser then opens the address as a page of its own, which says what is the matter.
export async function postsPage(
  threadId: number,
  select: boolean,
  page: number,
): Promise<ReactNode | null> {
  requireIds(threadId, page);
  try {
    const [found, { user }] = await Promise.all([
      call(threadsGet, { threadId }),
      getViewer(),
    ]);
    const context = postsContext(found, user?.id ?? null, select === true);
    if (found.seo.redirect || !context.contentOpen) return null;
    const posts = await readPosts(context, page, undefined, call);
    if (posts.posts.length === 0 && page > 1) return null;
    return (
      <PostsRegion
        context={context}
        page={page}
        cursor={undefined}
        posts={posts}
        inPlace
      />
    );
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
