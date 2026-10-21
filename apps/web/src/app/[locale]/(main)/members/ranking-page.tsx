import { usersList } from "@sermo/core/contracts";
import {
  numberedCursor,
  readNumbered,
} from "@/app/[locale]/(main)/members/numbered-cursor";
import type { MemberSort } from "@/app/[locale]/(main)/members/views";
import {
  type LeaderboardKind,
  LeaderboardRow,
} from "@/components/forum/leaderboard";
import type { ListPage } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

// One page of a ranking of the members who have something to count, drawn: the list's first page
// and each page the browser asks for. `numbered` is the cursor of the page (see
// `numberedCursor`), none for the first.
export async function rankingPage(
  sort: MemberSort,
  by: LeaderboardKind,
  numbered?: string,
  reader: typeof read = read,
): Promise<ListPage> {
  const { start, cursor } = readNumbered(numbered);
  const [{ items, nextCursor }, { user }] = await Promise.all([
    reader(usersList, { sort, ranked: true, cursor }),
    getViewer(),
  ]);
  return {
    nextCursor: nextCursor && numberedCursor(start + items.length, nextCursor),
    rows: items.map((member, index) => ({
      key: String(member.card.id),
      node: (
        <LeaderboardRow
          member={member}
          by={by}
          viewerId={user?.id}
          rank={start + index}
        />
      ),
    })),
  };
}
