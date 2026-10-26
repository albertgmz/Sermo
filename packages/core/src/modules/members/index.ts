import type { Ctx } from "../../context";
import { usersAuthors, usersCards } from "../../contracts/members";
import { implement } from "../../operation";
import { usersChangeUsernameOp } from "../auth/username";
import { loadViewerAuthors, loadViewerCards } from "./cards";
import { usersBirthdaysOp, usersListOp, usersStaffOp } from "./directory";
import { onlineCountsOp, onlineListOp, usersActivityOp } from "./online";
import { usersRecentlyActiveOp } from "./recently-active";
import { redecideStaleWinners, registerRedecideJobs } from "./redecide";
import { requireSiteViewForCards } from "./site-access";
import { siteStatsOp } from "./site-stats";
import {
  registerStandingJobs as registerRefreshJob,
  standingsMonthOp,
  standingsWinnersOp,
} from "./standings";

export { loadMemberAuthors, loadMemberCards } from "./cards";
export { flushVisits, pruneOnlineVisitors } from "./online-track";
export { forgetRecentlyActive } from "./recently-active-cache";
export { refreshStandings } from "./standings";

/** The standings refresh, and the job that decides past months again when their rules change or a stored winner is now left out. */
export function registerStandingJobs(ctx: Ctx): void {
  registerRefreshJob(ctx);
  registerRedecideJobs(ctx);
  redecideStaleWinners(ctx);
}

export const usersCardsOp = implement(
  usersCards,
  (ctx, actor, input) => {
    requireSiteViewForCards(ctx, actor, input.userIds);
    // A member whose block hides them from the viewer is left out, as an unknown id is.
    const cards = loadViewerCards(ctx, actor, input.userIds, { leaveOutBlocked: true });
    return { items: [...new Set(input.userIds)].flatMap((id) => cards.get(id) ?? []) };
  },
  {
    public:
      "A card holds only what is drawn next to a member's name wherever their content is visible; site.view is needed except for one's own card.",
  },
);

export const usersAuthorsOp = implement(
  usersAuthors,
  (ctx, actor, input) => {
    requireSiteViewForCards(ctx, actor, input.userIds);
    const authors = loadViewerAuthors(ctx, actor, input.userIds);
    return { items: [...new Set(input.userIds)].flatMap((id) => authors.get(id) ?? []) };
  },
  {
    public:
      "An author block holds only what is drawn around a member's content wherever it is visible; site.view is needed except for one's own.",
  },
);

export const operations = [
  usersCardsOp,
  usersAuthorsOp,
  usersListOp,
  usersStaffOp,
  usersBirthdaysOp,
  usersRecentlyActiveOp,
  usersActivityOp,
  onlineListOp,
  onlineCountsOp,
  siteStatsOp,
  standingsMonthOp,
  standingsWinnersOp,
  usersChangeUsernameOp,
];
