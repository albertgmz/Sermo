"use server";

import { preferencesUpdate } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { FEED_VIEW_COOKIE, parseFeedView } from "@/lib/feed-view";
import { call } from "@/lib/sermo/client";
import { attemptInPlace, invalidArgument } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

// Keeps how the visitor wants the feed drawn: on a member's account, in a cookie for a guest. The
// caller draws the page again. The answer carries the backend's message when it refuses.
export async function setFeedView(
  view: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const chosen = parseFeedView(view);
  if (!chosen) return { ok: false, error: await invalidArgument() };
  if ((await getViewer()).user) {
    const saved = await attemptInPlace("/", () =>
      call(preferencesUpdate, { feedView: chosen }),
    );
    if (!saved.ok) return { ok: false, error: saved.error };
  } else {
    (await cookies()).set(FEED_VIEW_COOKIE, chosen, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return { ok: true };
}
