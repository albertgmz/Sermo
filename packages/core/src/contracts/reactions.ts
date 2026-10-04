import * as z from "zod";
import { defineContract } from "../operation";
import {
  Empty,
  Id,
  Page,
  pageInput,
  ReactionContentType,
  ReactionSummary,
  Timestamp,
  UserSummary,
} from "./common";

export const ReactionType = z
  .object({
    id: Id,
    title: z.string(),
    emoji: z.string(),
    score: z.number().int(),
    position: z.number().int(),
    isActive: z.boolean(),
  })
  .meta({ id: "ReactionType" });

const ReactionTypeFields = {
  title: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(16),
  score: z.number().int().min(-10).max(10),
  position: z.number().int(),
  isActive: z.boolean(),
};

const ContentRef = { contentType: ReactionContentType, contentId: Id };

export const reactionTypesList = defineContract({
  name: "reactionTypes.list",
  summary: "All reaction types in display order (inactive ones included, flagged).",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(ReactionType) }),
});

export const reactionTypesCreate = defineContract({
  name: "reactionTypes.create",
  summary: "Add a reaction type. Admins only.",
  kind: "write",
  input: z.object({
    ...ReactionTypeFields,
    score: ReactionTypeFields.score.default(1),
    position: ReactionTypeFields.position.default(0),
    isActive: ReactionTypeFields.isActive.default(true),
  }),
  output: ReactionType,
});

export const reactionTypesUpdate = defineContract({
  name: "reactionTypes.update",
  summary:
    "Change a reaction type. Admins only. A new score applies to new reactions only; existing " +
    "reactions keep the score they were given with.",
  kind: "write",
  input: z.object({
    reactionTypeId: Id,
    title: ReactionTypeFields.title.optional(),
    emoji: ReactionTypeFields.emoji.optional(),
    score: ReactionTypeFields.score.optional(),
    position: ReactionTypeFields.position.optional(),
    isActive: ReactionTypeFields.isActive.optional(),
  }),
  output: ReactionType,
});

export const reactionsSet = defineContract({
  name: "reactions.set",
  summary:
    "React to an item, or change your existing reaction. One reaction per user per item; " +
    "you cannot react to your own content.",
  kind: "write",
  input: z.object({ ...ContentRef, reactionTypeId: Id }),
  output: ReactionSummary,
});

export const reactionsRemove = defineContract({
  name: "reactions.remove",
  summary: "Remove your reaction from an item (no-op if none).",
  kind: "write",
  input: z.object(ContentRef),
  output: ReactionSummary,
});

export const reactionsList = defineContract({
  name: "reactions.list",
  summary: "Who reacted to an item, and with what.",
  kind: "read",
  input: z.object({ ...ContentRef, ...pageInput }),
  output: Page(z.object({ user: UserSummary, reactionTypeId: Id, createdAt: Timestamp })),
});
