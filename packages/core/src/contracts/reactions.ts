import * as z from "zod";
import { defineContract } from "../operation";
import {
  Id,
  Page,
  pageInput,
  ReactionContentType,
  ReactionSummary,
  Timestamp,
  UserSummary,
} from "./common";
import { CriteriaRule } from "./criteria";
import { ImageReference } from "./images";
import { SUPPORTED_LANGUAGES } from "./settings";

/** Most frames a sprite sheet may hold. */
export const MAX_REACTION_FRAMES = 64;
/** Longest side, in pixels, of a reaction picture and of one frame of it. */
export const MAX_REACTION_IMAGE_SIDE = 2048;
/** Most forums a reaction type may be limited to. */
export const MAX_REACTION_FORUMS = 100;

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
    forumIds: z
      .array(Id)
      .describe(
        "The forums the type may be given in; empty = everywhere. Exactly the forums listed " +
          "(not their subforums). Content that is not in a forum (profile posts, comments, " +
          "conversations) counts as elsewhere: the type may be given there only when this list " +
          "is empty.",
      ),
    hideWhenLocked: z
      .boolean()
      .describe(
        "What a member the rule excludes sees: false = the type greyed with a hint (`access` " +
          "locked), true = the type left out of the picker (`access` hidden).",
      ),
    rule: CriteriaRule.nullable().describe(
      "Who may give the type, as a rule of cheap criteria (an empty rule is everyone). Criteria " +
        "that measure the member's history (`measured` in criteria.list) are refused, so the " +
        "rule costs at most three statements: the member's row, groups and purchases. Only " +
        "for holders of admin.reactionTypes; null for everyone else.",
    ),
    access: z
      .enum(["open", "locked", "hidden"])
      .describe(
        "What the viewer's standing against `rule` allows: `open` they may give it, " +
          "`locked` they may not and the picker shows it greyed, `hidden` they may not and " +
          "the picker leaves it out. A reaction already given with the type stays and counts " +
          "whatever this says. The forum limit (`forumIds`) is separate and applies to the item.",
      ),
    lockHint: z
      .string()
      .nullable()
      .describe(
        "In the viewer's language, why a `locked` type is locked (the requirements, phrased " +
          'from the rule\'s criteria; a plain "Locked" when the rule is too complex to ' +
          "phrase). Null unless `access` is locked.",
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
  rule: CriteriaRule,
  forumIds: z.array(Id).max(MAX_REACTION_FORUMS),
  hideWhenLocked: z.boolean(),
};

const ContentRef = { contentType: ReactionContentType, contentId: Id };

export const reactionTypesList = defineContract({
  name: "reactionTypes.list",
  summary:
    "All reaction types in display order (inactive ones included, flagged). Each carries the " +
    "viewer's standing against its rule (`access`, `lockHint`) and its forum limit " +
    "(`forumIds`), which clients mirror in the picker; reacting checks both again.",
  kind: "read",
  input: z.object({
    language: z
      .enum(SUPPORTED_LANGUAGES)
      .optional()
      .describe(
        "The language of `lockHint`; the viewer's own (else the site's) when left out. A " +
          "client that knows the language it draws in passes it, which saves the lookup.",
      ),
  }),
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
    rule: ReactionTypeFields.rule.default({ match: "all", conditions: [] }),
    forumIds: ReactionTypeFields.forumIds.default([]),
    hideWhenLocked: ReactionTypeFields.hideWhenLocked.default(false),
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
    "checked against the file as on creation, also when only the file changes. `rule` (only " +
    "`cheap` criteria, as it is checked on every reaction) says who may give the type and " +
    "`forumIds` (existing forums) where; both apply to new reactions only, one already given " +
    "stays and counts after its giver loses access, and cannot be given again.",
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
    rule: ReactionTypeFields.rule.optional(),
    forumIds: ReactionTypeFields.forumIds.optional(),
    hideWhenLocked: ReactionTypeFields.hideWhenLocked.optional(),
  }),
  output: ReactionType,
});

export const reactionsSet = defineContract({
  name: "reactions.set",
  summary:
    "React to an item, or change your existing reaction. One reaction per user per item; " +
    "you cannot react to your own content. A type whose rule you do not meet, or that is limited " +
    "to forums the item is not in, is refused (forbidden) unless it is the reaction you " +
    "already gave.",
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
