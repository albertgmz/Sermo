"use server";

import { nodesList, preferencesGet } from "@sermo/core/contracts";
import type { CreateLoad } from "@/components/forum/create-kinds";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { getViewer } from "@/lib/sermo/session";

// What the Create flow needs when it opens, asked once for the member who pressed the button: the
// forums with the ones they may post in marked, and the two permissions that are not a forum's
// (a forum's prefixes are asked when it is chosen). A refusal of any read is `{ ok: false }`, never a thrown error, so the flow can say it
// could not load and offer another try.
export async function loadCreateAction(): Promise<CreateLoad> {
  const viewer = await getViewer();
  if (!viewer.user) return { ok: false };
  try {
    const [{ items: nodes }, preferences] = await Promise.all([
      call(nodesList, {}),
      call(preferencesGet, {}),
    ]);
    return {
      ok: true,
      data: {
        memberId: viewer.user.id,
        forums: nodes.map(({ id, parentId, title, type, permissions }) => ({
          id,
          parentId,
          title,
          type,
          canPost: permissions.canPost,
        })),
        canTag: viewer.resolvedPermissions["tag.apply"] === true,
        canWall: viewer.permissions.canPostProfile,
        watchOnCreate: preferences.watchOnCreate,
      },
    };
  } catch (error) {
    // Anything that is not a refusal is Next's own control flow, or a bug.
    if (error instanceof SermoError) return { ok: false };
    throw error;
  }
}
