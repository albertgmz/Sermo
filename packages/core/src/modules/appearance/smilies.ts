import { prepared } from "../../context";
import { smiliesList } from "../../contracts/smilies";
import { implement } from "../../operation";

type SmilieRow = { id: number; title: string; codes: string; emoji: string };

export const smilieOperations = [
  implement(
    smiliesList,
    (ctx) => ({
      items: prepared(ctx, "appearance.smilies", () =>
        ctx.sqlite.prepare<SmilieRow, []>(
          "SELECT id, title, codes, emoji FROM smilies ORDER BY position, id",
        ),
      )
        .all()
        .map((row) => ({ ...row, codes: JSON.parse(row.codes) as string[] })),
    }),
    { public: "The site's smilies are what every visitor's text is drawn with." },
  ),
];
