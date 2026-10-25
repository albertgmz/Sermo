"use server";

import { nodesList, preferencesGet } from "@sermo/core/contracts";
import type { CreateLoad } from "@/components/forum/create-kinds";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { forumChoices } from "@/lib/sermo/forum-choices";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

// What the Create flow needs when it opens, asked once for the member who pressed the button: the
// forums with the ones they may post in marked, and the two permissions that are not a forum's
// (a forum's prefixes are asked when it is chosen). A refusal of any read is `{ ok: false }`, never a thrown error, so the flow can say it
// could not load and offer another try.
export async function loadCreateAction(): Promise<CreateLoad> {
  const viewer = await getViewer();
  if (!viewer.user) return { ok: false };
  try {
    const [{ items: nodes }, preferences, site] = await Promise.all([
      call(nodesList, {}),
      call(preferencesGet, {}),
      getSite(),
    ]);
    return {
      ok: true,
      data: {
        memberId: viewer.user.id,
        forums: await forumChoices(nodes),
        canTag: viewer.resolvedPermissions["tag.apply"] === true,
        canWall: viewer.permissions.canPostProfile,
        watchOnCreate: preferences.watchOnCreate,
        adultMode: site.adultMode,
      },
    };
  } catch (error) {
    // Anything that is not a refusal is Next's own control flow, or a bug.
    if (error instanceof SermoError) return { ok: false };
    throw error;
  }
}
