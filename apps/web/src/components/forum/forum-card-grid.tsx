import { ForumCard } from "@/components/forum/forum-card";
import { type ApiNode, forumCard } from "@/lib/sermo/forums";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

function holdsUnread(
  id: number,
  childrenOf: (parentId: number) => ApiNode[],
  unread: ReadonlySet<number>,
): boolean {
  return (
    unread.has(id) ||
    childrenOf(id).some((child) => holdsUnread(child.id, childrenOf, unread))
  );
}

// The forums of a node as cards, two to a row from the medium width, the last odd one across.
// Each card lists its own sub-forums.
//
// Props
//   forums       The forums to draw, in order.
//   childrenOf   The direct children of a node (`childrenByParent`).
//   member       The author of a last post, by id (`membersFor`).
//   unread       The ids of the forums with an unread thread (`unreadForums`); a card is unread
//                when its forum or one under it is.
//   signedIn     Whether the viewer is a member: the last post's thread opens where they left off.
//   className    Spacing of the list.
export function ForumCardGrid({
  forums,
  childrenOf,
  member,
  unread,
  signedIn,
  className,
}: {
  forums: ApiNode[];
  childrenOf: (parentId: number) => ApiNode[];
  member: (id: number) => MemberView;
  unread?: ReadonlySet<number>;
  signedIn: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-2 md:grid-cols-2", className)}>
      {forums.map((forum) => (
        <ForumCard
          key={forum.id}
          forum={forumCard(
            forum,
            childrenOf,
            member,
            unread !== undefined && holdsUnread(forum.id, childrenOf, unread),
            signedIn,
          )}
          className="md:last:odd:col-span-2"
        />
      ))}
    </ul>
  );
}
