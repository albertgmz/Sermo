import * as z from "zod";
import { SPOILER_CONTENT_TYPES } from "../db/schema";
import { defineContract } from "../operation";
import { Id } from "./common";

export const spoilersGet = defineContract({
  name: "spoilers.get",
  summary:
    "The HTML of one spoiler of a post, conversation message, profile post or comment. A body's " +
    "HTML holds only a placeholder naming the spoiler's position; the content is returned here " +
    "to a viewer who can see the item, and is not found otherwise.",
  kind: "read",
  input: z.object({
    contentType: z.enum(SPOILER_CONTENT_TYPES),
    contentId: Id,
    position: z.number().int().min(0).max(999),
  }),
  output: z.object({ html: z.string() }),
});
