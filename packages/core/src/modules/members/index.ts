import { usersAuthors, usersCards } from "../../contracts/members";
import { implement } from "../../operation";
import { usersChangeUsernameOp } from "../auth/username";
import { loadMemberAuthors, loadMemberCards } from "./cards";
import { usersBirthdaysOp, usersListOp, usersSetReferrerOp, usersStaffOp } from "./directory";
import { standingsMonthOp, standingsWinnersOp } from "./standings";

export { loadMemberAuthors, loadMemberCards } from "./cards";
export { refreshStandings, registerStandingJobs } from "./standings";

export const usersCardsOp = implement(
  usersCards,
  (ctx, actor, input) => {
    const cards = loadMemberCards(ctx, actor, input.userIds);
    return { items: [...new Set(input.userIds)].flatMap((id) => cards.get(id) ?? []) };
  },
  {
    public:
      "A card holds only what is drawn next to a member's name wherever their content is visible.",
  },
);

export const usersAuthorsOp = implement(
  usersAuthors,
  (ctx, actor, input) => {
    const authors = loadMemberAuthors(ctx, actor, input.userIds);
    return { items: [...new Set(input.userIds)].flatMap((id) => authors.get(id) ?? []) };
  },
  {
    public:
      "An author block holds only what is drawn around a member's content wherever it is visible.",
  },
);

export const operations = [
  usersCardsOp,
  usersAuthorsOp,
  usersListOp,
  usersStaffOp,
  usersBirthdaysOp,
  usersSetReferrerOp,
  standingsMonthOp,
  standingsWinnersOp,
  usersChangeUsernameOp,
];
