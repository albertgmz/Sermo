"use server";

import { reactionsRemove, reactionsSet } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type ReactionTarget, setReaction } from "@/lib/db";
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
import { getCurrentUser } from "@/lib/session";

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

const TARGETS: ReactionTarget[] = [
  "post",
  "profilePost",
  "profileComment",
  "message",
];

// The targets the backend keeps, with the content type it knows them by.
const BACKEND_CONTENT = {
  post: "post",
  profilePost: "profile_post",
  profileComment: "profile_post_comment",
} as const;

export async function react(
  target: ReactionTarget,
  id: number,
  typeId: number | null,
) {
  if (!TARGETS.includes(target)) return;
  const contentType = BACKEND_CONTENT[target as keyof typeof BACKEND_CONTENT];
  if (contentType) {
    // These live in the backend, which refuses what the viewer may not do; the button reverts.
    await attempt("/", () =>
      typeId === null
        ? call(reactionsRemove, { contentType, contentId: id })
        : call(reactionsSet, {
            contentType,
            contentId: id,
            reactionTypeId: typeId,
          }),
    );
    revalidatePath("/", "layout");
    return;
  }
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await setReaction({ target, id, userId: user.id, typeId });
  revalidatePath("/", "layout");
}
