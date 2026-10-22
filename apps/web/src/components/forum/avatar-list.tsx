import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { MemberView } from "@/lib/sermo/views";

// Members as a row of avatars, each opening the member's card on hover and linking to the profile;
// the name is there for a screen reader.
export function AvatarList({ members }: { members: MemberView[] }) {
  return (
    <ul className="flex flex-wrap gap-2 px-4 py-3">
      {members.map((member) => (
        <li key={member.id}>
          <UserLink user={member} className="block w-fit rounded-full">
            <UserAvatar user={member} size="lg" link={false} />
            <span className="sr-only">{member.username}</span>
          </UserLink>
        </li>
      ))}
    </ul>
  );
}
