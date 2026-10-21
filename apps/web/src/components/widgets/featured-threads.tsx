import { threadsFeatured } from "@sermo/core/contracts";
import { ThreadTitle } from "@/app/[locale]/(main)/_feed/thread-title";
import { FeatureMark } from "@/components/forum/feature-mark";
import { SectionCard } from "@/components/forum/section-card";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { readIfAllowed } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { threadMembers } from "@/lib/sermo/threads";

// How many featured threads the block lists.
const FEATURED_SIZE = 3;

// The threads featured right now, newest feature first: staff picks and paid promotions. Nothing
// is drawn when there are none.
export async function FeaturedThreads({
  title,
}: Pick<WidgetBodyProps<"featured">, "title">) {
  const featured = await readIfAllowed(threadsFeatured, {
    limit: FEATURED_SIZE,
  });
  if (!featured || featured.items.length === 0) return null;
  const { items } = featured;
  const member = await membersFor(
    items.flatMap(({ thread }) => threadMembers(thread)),
  );
  return (
    <SectionCard title={title}>
      {items.map(({ kind, thread }) => (
        <div key={thread.id} className="px-4 py-2.5">
          <ThreadTitle thread={thread} member={member} />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <FeatureMark kind={kind} /> · {thread.node.title}
          </p>
        </div>
      ))}
    </SectionCard>
  );
}
