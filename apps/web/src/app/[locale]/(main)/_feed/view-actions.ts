"use server";

import { preferencesUpdate } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { FEED_VIEW_COOKIE, parseFeedView } from "@/lib/feed-view";
import { call } from "@/lib/sermo/client";
import { secureCookies } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { attemptInPlace, invalidArgument } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

// Keeps how the visitor wants the feed drawn: on a member's account, in a cookie for a guest and
// for a member whose group may not edit their own profile (the account's preferences are closed
// to them, so the layout is kept per browser; `getFeedView` reads the cookie for them). The caller
// loads the page again. The answer carries the backend's message when it refuses, and where to
// sign in when the session has ended.
export async function setFeedView(
  view: string,
): Promise<{ ok: true } | { ok: false; error: string; signIn?: string }> {
  const chosen = parseFeedView(view);
  if (!chosen) return { ok: false, error: await invalidArgument() };
  const { user, resolvedPermissions } = await getViewer();
  if (user && resolvedPermissions["profile.editOwn"] !== false) {
    const saved = await attemptInPlace("/", async () => {
      try {
        await call(preferencesUpdate, { feedView: chosen });
        return "account" as const;
      } catch (error) {
        // A refusal for the permission itself: the browser keeps the choice instead.
        if (error instanceof SermoError && error.code === "forbidden")
          return "browser" as const;
        throw error;
      }
    });
    if (!saved.ok)
      return {
        ok: false,
        error: saved.error,
        ...(saved.signIn ? { signIn: saved.signIn } : {}),
      };
    if (saved.value === "account") return { ok: true };
  }
  (await cookies()).set(FEED_VIEW_COOKIE, chosen, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return { ok: true };
}
