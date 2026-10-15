import { MemberCardScope } from "@/components/forum/member-card-scope";
import type { ReactionType } from "@/components/forum/reaction-button";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { MemberView } from "@/lib/sermo/views";

// Who reacted and with what, as the popover of a reaction summary lists them. A reaction whose
// type is gone has no picture.
export function ReactionMemberList({
  rows,
}: {
  rows: { user: MemberView; type?: ReactionType }[];
}) {
  return (
    <MemberCardScope disabled>
      <ul className="max-h-64 overflow-y-auto py-1">
        {rows.map(({ user, type }) => (
          <li
            key={user.id}
            className="flex min-h-10 items-center gap-2 px-3 text-sm"
          >
            <UserAvatar user={user} size="sm" />
            <UserLink user={user} className="min-w-0 flex-1 truncate" />
            {type && (
              <span title={type.label}>
                <ReactionPicture
                  emoji={type.emoji}
                  picture={type.picture}
                  label={type.label}
                />
              </span>
            )}
          </li>
        ))}
      </ul>
    </MemberCardScope>
  );
}
