"use server";

import { reactionsList } from "@sermo/core/contracts";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getReactionTypes } from "@/lib/sermo/reactions";

// Renders the rows on the server so the avatars keep reading the LITE cookie. Only called once
// the list is first opened.
export async function loadReactionUsers(
  contentType: "post" | "profile_post" | "conversation_message",
  contentId: number,
) {
  const [{ items }, types] = await Promise.all([
    call(reactionsList, { contentType, contentId }),
    getReactionTypes(),
  ]);
  const member = await membersFor(items.map((item) => item.user));
  return (
    <ul className="max-h-64 overflow-y-auto py-1">
      {items.map(({ user, reactionTypeId }) => {
        const type = types.find((entry) => entry.id === reactionTypeId);
        return (
          <li
            key={user.id}
            className="flex min-h-10 items-center gap-2 px-3 text-sm"
          >
            <UserAvatar user={member(user.id)} size="sm" />
            <UserLink
              user={member(user.id)}
              className="min-w-0 flex-1 truncate"
            />
            {type && (
              <span role="img" aria-label={type.title} title={type.title}>
                {type.emoji}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
