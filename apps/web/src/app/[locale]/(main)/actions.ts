"use server";

import {
  postsCreate,
  reactionsRemove,
  reactionsSet,
  usersFollow,
  usersUnfollow,
} from "@sermo/core/contracts";
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { LineComposerState } from "@/components/forum/line-composer";
import { normalizeImagePath } from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "@/lib/lite-preferences";
import { signOut } from "@/lib/sermo/auth";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { attempt } from "@/lib/sermo/outcome";
import { safeReturnPath } from "@/lib/sermo/return-path";

export async function setLiteMode(formData: FormData) {
  const store = await cookies();
  const mode = formData.get("mode");
  const categories = formData.getAll("category");
  const state = updateLiteState(
    parseLiteCookieHeader(store.toString()),
    mode,
    categories,
    formData.get("source") === "settings",
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

// The page the reaction was made on, as the browser names it. Without one, or with one that is
// not on this site, the visitor lands on the home page after signing in.
async function pageOfRequest(): Promise<string> {
  const sent = await headers();
  const referer = sent.get("referer");
  if (!referer || !URL.canParse(referer)) return "/";
  const { host, pathname, search } = new URL(referer);
  if (host !== (sent.get("x-forwarded-host") ?? sent.get("host"))) return "/";
  return safeReturnPath(pathname + search);
}

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

// Replies to a thread from its card in the feed and goes back to the feed address the form was
// on. That address can differ from the one in the browser by its hash alone (the comment count
// leads to the composer), which is no navigation to the server, so the page is refreshed first.
export async function replyFromFeed(
  threadId: number,
  returnTo: string,
  _previous: LineComposerState,
  formData: FormData,
): Promise<LineComposerState> {
  requireIds(threadId);
  const body = String(formData.get("body") ?? "");
  const created = await attempt(returnTo, () =>
    call(postsCreate, { threadId, body }),
  );
  if (!created.ok) return { error: created.error };
  refresh();
  redirect(safeReturnPath(returnTo));
}
