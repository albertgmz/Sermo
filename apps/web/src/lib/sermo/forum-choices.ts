import "server-only";

import type {
  ForumArt,
  ForumArtUrl,
} from "@/components/forum/forum-choice-art";
import type { ForumChoice } from "@/components/forum/forum-choices";
import { liteBlocks } from "@/lib/lite-mode";
import { liteCategoryOfPurpose } from "@/lib/lite-preferences";
import type { ApiNode } from "./forums";

// The nodes as both forum choosers take them (the Create dialog's and the thread composer's). The
// picture is the one the forum cards draw, the cover else the icon, and it meets LITE here: when
// the visitor blocks forum art the address is dropped, so no later step can send it to the browser.
export async function forumChoices(nodes: ApiNode[]): Promise<ForumChoice[]> {
  const coverBlocked = await liteBlocks(liteCategoryOfPurpose("node_cover"));
  const iconBlocked = await liteBlocks(liteCategoryOfPurpose("node_icon"));
  return nodes.map((node) => {
    const cover = coverBlocked ? null : node.cover;
    const icon = iconBlocked ? null : node.icon;
    const image: ForumArt | null = cover
      ? { url: cover.url as ForumArtUrl, kind: "cover" }
      : icon
        ? { url: icon.url as ForumArtUrl, kind: "icon" }
        : null;
    return {
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      type: node.type,
      canPost: node.permissions.canPost,
      readOnly: node.settings.isReadOnly,
      image,
    };
  });
}
