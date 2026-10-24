import { usersList } from "@sermo/core/contracts";
import { useTranslations } from "next-intl";
import {
  type MemberSort,
  VIEWS,
  type ViewValue,
} from "@/app/[locale]/(main)/members/views";
import {
  type LeaderboardKind,
  LeaderboardRow,
} from "@/components/forum/leaderboard";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import { SectionHeader } from "@/components/forum/section-card";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { MEMBERS_PER_PAGE } from "@/lib/sermo/page-sizes";
import { getViewer } from "@/lib/sermo/session";

export const MEMBERS_PATH = "/members";

export type RankingPage = { rows: ListRow[]; total: number };

// One numbered page of a ranking of the members who have something to count, drawn, with how many
// members the ranking holds. Ranks run on from the pages before.
export async function rankingPage(
  sort: MemberSort,
  by: LeaderboardKind,
  page: number,
  reader: typeof read = read,
): Promise<RankingPage> {
  const [{ items, total }, { user }] = await Promise.all([
    reader(usersList, { sort, ranked: true, page }),
    getViewer(),
  ]);
  const start = (page - 1) * MEMBERS_PER_PAGE + 1;
  return {
    total: total ?? 0,
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

// The part of a ranking's view that turns with its pages (`PageSwitch`): the pagers and the card
// of members, headed with the view's name.
export function RankingPages({
  view,
  page,
  list,
}: {
  view: ViewValue;
  page: number;
  list: RankingPage;
}) {
  const t = useTranslations("members.views");
  const label = VIEWS.find((entry) => entry.value === view)?.label;
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, MEMBERS_PER_PAGE)}
      path={MEMBERS_PATH}
      params={{ view }}
      rows={list.rows}
      header={label && <SectionHeader title={t(label)} />}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
