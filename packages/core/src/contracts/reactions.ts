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
import { ImageReference } from "./images";

/** Most frames a sprite sheet may hold. */
export const MAX_REACTION_FRAMES = 64;
/** Longest side, in pixels, of a reaction picture and of one frame of it. */
export const MAX_REACTION_IMAGE_SIDE = 2048;

export const ReactionType = z
  .object({
    id: Id,
    title: z.string(),
    emoji: z.string(),
    score: z.number().int(),
    position: z.number().int(),
    isActive: z.boolean(),
    image: ImageReference.describe(
      "Picture drawn instead of the emoji where pictures can be shown; null when there is none. " +
        "The emoji stays as the fallback everywhere else.",
    ),
    frames: z
      .object({
        width: z.number().int().describe("Width of one frame in pixels."),
        height: z.number().int().describe("Height of one frame in pixels."),
        count: z.number().int().describe("Frames used, read left to right, then top to bottom."),
        columns: z.number().int().describe("Frames per row of the picture (its width / `width`)."),
      })
      .nullable()
      .describe(
        "How to cut the picture into frames; null for a plain image (the whole picture is the " +
          "frame) and when there is no picture. A sprite sheet with more than one frame is " +
          "played as an animation by clients.",
      ),
  })
  .meta({ id: "ReactionType" });

const ReactionTypeFields = {
  title: z.string().trim().min(1).max(50),
  emoji: z.string().trim().min(1).max(16),
  score: z.number().int().min(-10).max(10),
  position: z.number().int(),
  isActive: z.boolean(),
  fileId: Id.describe(
    "An unattached file the actor uploaded with the purpose `reaction_image` (png or webp, " +
      `at most ${MAX_REACTION_IMAGE_SIDE} pixels on a side, not animated, stored without ` +
      "rescaling).",
  ),
  frameWidth: z
    .number()
    .int()
    .min(1)
    .max(MAX_REACTION_IMAGE_SIDE)
    .describe("Width of one frame of a sprite sheet; it must divide the picture's width."),
  frameHeight: z
    .number()
    .int()
    .min(1)
    .max(MAX_REACTION_IMAGE_SIDE)
    .describe("Height of one frame of a sprite sheet; it must divide the picture's height."),
  frameCount: z
    .number()
    .int()
    .min(1)
    .max(MAX_REACTION_FRAMES)
    .describe(
      "Frames used, at most the cells the picture holds. More than one needs a frame size.",
    ),
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
  summary:
    "Add a reaction type. Admins only. `fileId` gives it a picture; `frameWidth`, " +
    "`frameHeight` and `frameCount` cut the picture into the frames of a sprite sheet, checked " +
    "against the uploaded file (both sizes together, dividing the picture, at most as many " +
    "frames as it holds).",
  kind: "write",
  input: z.object({
    ...ReactionTypeFields,
    fileId: ReactionTypeFields.fileId.optional(),
    frameWidth: ReactionTypeFields.frameWidth.optional(),
    frameHeight: ReactionTypeFields.frameHeight.optional(),
    frameCount: ReactionTypeFields.frameCount.default(1),
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
    "reactions keep the score they were given with. A new `fileId` replaces the picture (the " +
    "old file is deleted); `fileId: null` removes it and the frames with it. `frameWidth: null` " +
    "(with `frameHeight: null`) goes back to the whole picture as the one frame. The frames are " +
    "checked against the file as on creation, also when only the file changes.",
  kind: "write",
  input: z.object({
    reactionTypeId: Id,
    title: ReactionTypeFields.title.optional(),
    emoji: ReactionTypeFields.emoji.optional(),
    score: ReactionTypeFields.score.optional(),
    position: ReactionTypeFields.position.optional(),
    isActive: ReactionTypeFields.isActive.optional(),
    fileId: ReactionTypeFields.fileId.nullable().optional(),
    frameWidth: ReactionTypeFields.frameWidth.nullable().optional(),
    frameHeight: ReactionTypeFields.frameHeight.nullable().optional(),
    frameCount: ReactionTypeFields.frameCount.optional(),
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
