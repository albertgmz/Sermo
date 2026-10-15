import { PrefixTag } from "@/components/forum/prefix-tag";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import type { membersFor } from "@/lib/sermo/members";
import { type ApiThread, threadCard } from "@/lib/sermo/threads";

// A thread's title as a link with its hover card, for the lists of the home page.
export function ThreadTitle({
  thread,
  member,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
}) {
  const card = threadCard(thread, member);
  return (
    <ThreadHoverCard
      thread={card}
      className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] hover:underline"
    >
      {card.prefix && (
        <PrefixTag
          prefix={card.prefix}
          className="mr-1.5 align-(--prefix-offset)"
        />
      )}
      {card.title}
    </ThreadHoverCard>
  );
}
