"use server";

import { reactionsRemove, reactionsSet } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalizeImagePath } from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "@/lib/lite-preferences";
import { signOut } from "@/lib/sermo/auth";
import { call } from "@/lib/sermo/client";
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
  const returnTo = String(formData.get("returnTo") ?? "/");
  const path = normalizeImagePath(returnTo.split(/[?#]/)[0]);
  redirect(
    returnTo.startsWith("/") &&
      !/^\/[\\/]|[\s\\]/.test(returnTo) &&
      path !== "/_next" &&
      !path.startsWith("/_next/")
      ? returnTo
      : "/",
  );
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

// The page the reaction was made on, as the browser names it. Without one the visitor lands on
// the home page after signing in.
async function pageOfRequest(): Promise<string> {
  const referer = (await headers()).get("referer");
  if (!referer || !URL.canParse(referer)) return "/";
  const { pathname, search } = new URL(referer);
  return safeReturnPath(pathname + search);
}

export async function react(
  target: ReactionTarget,
  id: number,
  typeId: number | null,
): Promise<ReactionState> {
  if (!Object.hasOwn(CONTENT, target)) return {};
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
  // Only the page the reaction was made on shows it.
  revalidatePath(page.split(/[?#]/)[0]);
  return {};
}
