import Link from "next/link";
import {
  Leaderboard,
  LeaderboardScore,
  RankNumber,
} from "@/components/forum/leaderboard";
import { UserAvatar } from "@/components/forum/user-avatar";
import { userNameClass } from "@/components/forum/user-link";
import type { LeaderboardKind, UserView } from "@/lib/db";
import { cn } from "@/lib/utils";

export function Podium({
  members,
  by,
  viewerId,
}: {
  members: UserView[];
  by: LeaderboardKind;
  viewerId?: number;
}) {
  if (members.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        No members yet.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border">
      <ol
        aria-label="Top three"
        className={cn(
          "grid grid-cols-3 items-end gap-1 px-3 pt-2",
          members.length === 2 && "grid-cols-2",
        )}
      >
        {members.slice(0, 3).map((member, index) => (
          <li
            key={member.id}
            className={cn(
              "row-start-1 min-w-0",
              index === 0 && "col-start-2",
              index === 1 && "col-start-1",
              index === 2 && "col-start-3",
            )}
          >
            <Link
              href={`/members/${member.username}`}
              className={cn(
                "group flex min-w-0 flex-col items-center rounded-t-md px-1 pt-2 transition-colors hover:bg-muted/60",
                member.id === viewerId && "bg-primary/5",
              )}
            >
              <UserAvatar
                user={member}
                size={index === 0 ? "xl" : "lg"}
                link={false}
              />
              <span
                className={cn(
                  "mt-1 block w-full truncate text-center text-sm font-semibold group-hover:underline",
                  userNameClass(member),
                )}
              >
                {member.username}
              </span>
              <div className="flex min-h-5 w-full justify-center">
                <LeaderboardScore member={member} by={by} compact />
              </div>
              <div
                className={cn(
                  "mt-1 flex w-full justify-center rounded-t-md border border-b-0",
                  index === 0 && "h-8 border-tier-gold/40 bg-tier-gold/10",
                  index === 1 && "h-6 border-tier-silver/30 bg-tier-silver/10",
                  index === 2 && "h-5 border-tier-bronze/30 bg-tier-bronze/10",
                )}
              >
                <span className="sr-only">Rank </span>
                <RankNumber rank={index + 1} />
              </div>
            </Link>
          </li>
        ))}
      </ol>
      {members.length > 3 && (
        <Leaderboard
          members={members.slice(3)}
          by={by}
          viewerId={viewerId}
          start={4}
          compact
        />
      )}
    </div>
  );
}
