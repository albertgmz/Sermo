"use server";

import { nodesList, threadPrefixesList } from "@sermo/core/contracts";
import type { CreateLoad } from "@/components/forum/create-kinds";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { getViewer } from "@/lib/sermo/session";
import { prefixView } from "@/lib/sermo/threads";

// What the Create flow needs when it opens, asked once for the member who pressed the button: the
// forums with the ones they may post in marked, the prefixes, and the two permissions that are not
// a forum's. A refusal of any read is `{ ok: false }`, never a thrown error, so the flow can say it
// could not load and offer another try.
export async function loadCreateAction(): Promise<CreateLoad> {
  const viewer = await getViewer();
  if (!viewer.user) return { ok: false };
  try {
    const [{ items: nodes }, { items: prefixItems }] = await Promise.all([
      call(nodesList, {}),
      call(threadPrefixesList, {}),
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
        prefixes: prefixItems.flatMap((prefix) =>
          prefix.isActive ? (prefixView(prefix) ?? []) : [],
        ),
        canTag: viewer.resolvedPermissions["tag.apply"] === true,
        canWall: viewer.permissions.canPostProfile,
      },
    };
  } catch (error) {
    // Anything that is not a refusal is Next's own control flow, or a bug.
    if (error instanceof SermoError) return { ok: false };
    throw error;
  }
}
