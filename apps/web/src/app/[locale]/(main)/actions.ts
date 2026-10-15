"use server";

import {
  bookmarksSet,
  noticesDismiss,
  postsCreate,
  reactionsRemove,
  reactionsSet,
  reportsCreate,
  usersFollow,
  usersUnfollow,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { LineComposerState } from "@/components/forum/line-composer";
import { LOCALE_COOKIE, LOCALE_COOKIE_OPTIONS } from "@/i18n/locale-cookie";
import { isLocale } from "@/i18n/locales";
import { normalizeImagePath } from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "@/lib/lite-preferences";
import {
  NOTICES_DISMISSED_COOKIE,
  withDismissed,
} from "@/lib/notice-dismissals";
import { signOut } from "@/lib/sermo/auth";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { pageOfRequest } from "@/lib/sermo/request-page";
import { safeReturnPath } from "@/lib/sermo/return-path";
import { getViewer } from "@/lib/sermo/session";

export async function setLiteMode(formData: FormData) {
  const store = await cookies();
  const mode = formData.get("mode");
  const categories = formData.getAll("category");
  const state = updateLiteState(
    parseLiteCookieHeader(store.toString()),
    mode,
    categories,
  );
  if (state) {
    const value = serializeLiteCookie(state);
    if (value) {
      store.set(LITE_COOKIE, value, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    } else {
      store.delete(LITE_COOKIE);
    }
  }
  const returnTo = safeReturnPath(formData.get("returnTo"));
  const path = normalizeImagePath(returnTo.split(/[?#]/)[0]);
  redirect(path === "/_next" || path.startsWith("/_next/") ? "/" : returnTo);
}

// Writes the language cookie for `LocaleSync`. A Server Action on purpose: a cookie it sets drops
// the pages the router kept, which are in the old language. The page is read again by the caller.
export async function setLocaleCookie(language: string) {
  if (!isLocale(language)) return;
  (await cookies()).set(LOCALE_COOKIE, language, LOCALE_COOKIE_OPTIONS);
}

// Hides a site notice from the visitor: a member's dismissal is kept by the backend, a guest's in
// a cookie. The page is drawn again without it.
export async function dismissNotice(noticeId: number) {
  requireIds(noticeId);
  if ((await getViewer()).user) {
    // A refusal (the notice is gone, or no longer shown) is no use to the visitor: the page is
    // drawn again either way, which brings it up to date.
    await attempt("/", () => call(noticesDismiss, { noticeId }));
  } else {
    const store = await cookies();
    store.set(
      NOTICES_DISMISSED_COOKIE,
      withDismissed(store.get(NOTICES_DISMISSED_COOKIE)?.value, noticeId),
      {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      },
    );
  }
  refresh();
}

export async function logout() {
  await signOut();
  redirect("/");
}

// What each place a reaction can sit is called in the backend.
const CONTENT = {
  post: "post",
  profilePost: "profile_post",
  profileComment: "profile_post_comment",
  message: "conversation_message",
} as const;

export type ReactionTarget = keyof typeof CONTENT;

export type ReactionState = { error?: string };
export type FollowState = { error?: string };

export async function react(
  target: ReactionTarget,
  id: number,
  typeId: number | null,
): Promise<ReactionState> {
  if (!Object.hasOwn(CONTENT, target)) return {};
  requireIds(id);
  if (typeId !== null) requireIds(typeId);
  const contentType = CONTENT[target];
  const page = await pageOfRequest();
  // The backend refuses what the viewer may not do; a guest is sent to sign in and back.
  const done = await attempt(page, () =>
    typeId === null
      ? call(reactionsRemove, { contentType, contentId: id })
      : call(reactionsSet, {
          contentType,
          contentId: id,
          reactionTypeId: typeId,
        }),
  );
  if (!done.ok) return { error: done.error };
  // The page the member is on is drawn again with the reaction in it: the button keeps its own
  // choice only until the action ends. Which page that is does not matter, and nothing is cached
  // per visitor, so no path is named.
  refresh();
  return {};
}

// What a report can be about, as the backend names it.
const REPORTABLE = [
  "post",
  "profile_post",
  "profile_post_comment",
  "conversation_message",
] as const;

export type ReportableType = (typeof REPORTABLE)[number];

// Files a report from the form under a post, message, wall post or comment: the one action of every
// surface that reports. The page stays as it is; the form says that the report was taken.
export async function reportContent(
  type: ReportableType,
  id: number,
  _previous: { error?: string; done?: boolean },
  formData: FormData,
): Promise<{ error?: string; done?: boolean }> {
  if (!REPORTABLE.includes(type)) return {};
  requireIds(id);
  const done = await attempt("/", () =>
    call(reportsCreate, {
      target: { type, id },
      reason: String(formData.get("reason") ?? ""),
    }),
  );
  return done.ok ? { done: true } : { error: done.error };
}

// Follows or unfollows a member from where their name is drawn (a post, a card) and stays on the
// page: it is drawn again, so the scroll position and the address of a post survive. The caller
// says which state it wants, so a second click on a stale page cannot flip it back.
export async function followFromPage(
  userId: number,
  follow: boolean,
): Promise<FollowState> {
  requireIds(userId);
  const page = await pageOfRequest();
  const done = await attempt(page, async () => {
    if (follow === true) await call(usersFollow, { userId });
    else await call(usersUnfollow, { userId });
  });
  if (!done.ok) return { error: done.error };
  refresh();
  return {};
}

export type BookmarkState = { error?: string };
const BOOKMARKABLE = ["thread", "post", "conversation"] as const;

// Bookmarks or un-bookmarks an item from where it is drawn and stays on the page. The caller says
// which state it wants, so a second click on a stale page cannot flip it back.
export async function setBookmark(
  contentType: (typeof BOOKMARKABLE)[number],
  contentId: number,
  bookmarked: boolean,
): Promise<BookmarkState> {
  if (!BOOKMARKABLE.includes(contentType)) return {};
  requireIds(contentId);
  const page = await pageOfRequest();
  const done = await attempt(page, () =>
    call(bookmarksSet, { contentType, contentId, bookmarked }),
  );
  if (!done.ok) return { error: done.error };
  refresh();
  return {};
}

// Replies to a thread from its card in the feed and goes back to the address the form was on: the
// feed as the visitor has it, `?pages=N` included, so the list and the place in it stay. That
// address can differ from the one in the browser by its hash alone (the comment count leads to
// the composer), which is no navigation to the server, so the page is refreshed first.
export async function replyFromFeed(
  threadId: number,
  _previous: LineComposerState,
  formData: FormData,
): Promise<LineComposerState> {
  requireIds(threadId);
  const body = String(formData.get("body") ?? "");
  const page = await pageOfRequest();
  const created = await attempt(page, () =>
    call(postsCreate, { threadId, body }),
  );
  if (!created.ok) return { error: created.error };
  refresh();
  redirect(page);
}
