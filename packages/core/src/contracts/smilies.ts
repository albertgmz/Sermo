import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id } from "./common";

export const Smilie = z
  .object({
    id: Id,
    title: z.string(),
    codes: z
      .array(z.string())
      .describe(
        "The texts that stand for the smilie, matched case-sensitively anywhere in a text (as " +
          "XenForo does), the longest first; the first is the one a picker inserts.",
      ),
    emoji: z.string().describe("What the smilie is drawn as."),
  })
  .meta({ id: "Smilie" });

export const smiliesList = defineContract({
  name: "smilies.list",
  summary:
    "The site's smilies in display order. Bodies keep the codes as they were typed: clients " +
    "replace them where text is shown, outside code, links and mentions. Open to everyone.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(Smilie) }),
});
