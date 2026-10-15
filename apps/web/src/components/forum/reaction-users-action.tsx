"use server";

import { reactionsList } from "@sermo/core/contracts";
import { ReactionMemberList } from "@/components/forum/reaction-member-list";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { asType, getReactionTypes } from "@/lib/sermo/reactions";

// Renders the rows on the server so the avatars keep reading the LITE cookie. Only called once
// the list is first opened.
export async function loadReactionUsers(
  contentType:
    | "post"
    | "profile_post"
    | "profile_post_comment"
    | "conversation_message",
  contentId: number,
) {
  const [{ items }, types] = await Promise.all([
    call(reactionsList, { contentType, contentId }),
    getReactionTypes(),
  ]);
  const member = await membersFor(items.map((item) => item.user));
  return (
    <ReactionMemberList
      rows={items.map(({ user, reactionTypeId }) => {
        const type = types.find((entry) => entry.id === reactionTypeId);
        return { user: member(user.id), type: type && asType(type) };
      })}
    />
  );
}
