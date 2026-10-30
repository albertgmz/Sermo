import { awardsHolders } from "@sermo/core/contracts";
import { LevelBadge } from "@/components/forum/level";
import { RelativeTime } from "@/components/forum/relative-time";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

// One page of an award's holders, newest grant first, drawn: the list's first page and each page
// the browser asks for. A member holding a stackable award twice is two grants and two rows: the
// list is as the backend returns it.
export async function holdersPage(
  awardId: number,
  cursor?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const [holders, { user }] = await Promise.all([
    reader(awardsHolders, { awardId, cursor }),
    getViewer(),
  ]);
  const member = await membersFor(
    holders.items.map(({ user: holder }) => holder),
  );
  return {
    nextCursor: holders.nextCursor,
    rows: holders.items.map((grant) => {
      const holder = member(grant.user.id);
      return {
        key: String(grant.id),
        node: (
          <div
            className={cn(
              "flex min-h-14 items-center gap-3 px-4 py-2",
              grant.user.id === user?.id && "bg-primary/5",
            )}
          >
            <UserAvatar user={holder} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <UserLink user={holder} className="truncate text-sm" />
                <UserBadges user={holder} limit={1} />
                <LevelBadge level={holder} />
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {grant.reason || holder.title}
              </p>
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              <RelativeTime date={grant.grantedAt} />
            </div>
          </div>
        ),
      };
    }),
  };
}
