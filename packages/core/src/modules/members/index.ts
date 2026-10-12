import { usersAuthors, usersCards } from "../../contracts/members";
import { implement } from "../../operation";
import { loadMemberAuthors, loadMemberCards } from "./cards";

export { loadMemberAuthors, loadMemberCards } from "./cards";

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

export const operations = [usersCardsOp, usersAuthorsOp];
