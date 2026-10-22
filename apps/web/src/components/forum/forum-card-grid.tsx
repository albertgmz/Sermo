import { ForumCard } from "@/components/forum/forum-card";
import { type ApiNode, forumCard } from "@/lib/sermo/forums";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// The forums of a node as cards, two to a row from the medium width, the last odd one across.
// Each card lists its own sub-forums.
//
// Props
//   forums       The forums to draw, in order.
//   childrenOf   The direct children of a node (`childrenByParent`).
//   member       The author of a last post, by id (`membersFor`).
//   className    Spacing of the list.
export function ForumCardGrid({
  forums,
  childrenOf,
  member,
  className,
}: {
  forums: ApiNode[];
  childrenOf: (parentId: number) => ApiNode[];
  member: (id: number) => MemberView;
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-2 md:grid-cols-2", className)}>
      {forums.map((forum) => (
        <ForumCard
          key={forum.id}
          forum={forumCard(forum, childrenOf(forum.id), member)}
          className="md:last:odd:col-span-2"
        />
      ))}
    </ul>
  );
}
