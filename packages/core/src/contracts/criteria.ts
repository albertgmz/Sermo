import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id } from "./common";

/** The most a rule's conditions, a condition's number and a condition's ids may be. */
export const MAX_RULE_CONDITIONS = 20;
export const MAX_CONDITION_VALUE = 1_000_000_000;
export const MAX_CONDITION_IDS = 500;
/** The longest window a condition may look back over, in days (ten years). */
export const MAX_CONDITION_DAYS = 3650;

/** What a list of ids in a condition names. */
export const CRITERION_ID_KINDS = [
  "groups",
  "members",
  "threads",
  "awards",
  "shopItems",
  "shopCategories",
  "creditRules",
] as const;

/**
 * How a condition reads a list of ids: `one` holds when any of them meets it, `each` when every
 * one does, `all` when they meet it added together, `none` when no one does.
 */
export const CRITERION_MODES = ["one", "all", "each", "none"] as const;

/**
 * One condition of a rule. `criterion` is an id from the criteria registry; what it takes depends
 * on the criterion (see `CriterionDefinition`): a threshold or 1/0 for yes/no criteria in `value`,
 * a list of ids (groups, members, threads, awards, ...) in `ids`, a look-back window in `days` and
 * how a list is read in `mode`. The server refuses a condition that lacks what its criterion needs
 * or carries what it does not take.
 */
export const CriteriaCondition = z
  .object({
    criterion: z.string().min(1).max(50),
    value: z.number().int().min(0).max(MAX_CONDITION_VALUE).optional(),
    ids: z.array(Id).min(1).max(MAX_CONDITION_IDS).optional(),
    days: z.number().int().min(1).max(MAX_CONDITION_DAYS).optional(),
    mode: z.enum(CRITERION_MODES).optional(),
  })
  .meta({ id: "CriteriaCondition" });

const conditions = z.array(CriteriaCondition).max(MAX_RULE_CONDITIONS);

/**
 * Who something applies to: `match` `all` needs every condition to hold, `any` needs one. An
 * empty list of conditions means everyone, whatever `match` says.
 */
export const CriteriaRule = z
  .object({ match: z.enum(["all", "any"]), conditions })
  .meta({ id: "CriteriaRule" });

/** A rule for consumers where an empty rule would be a mistake (a promotion). */
export const NonEmptyCriteriaRule = z
  .object({ match: z.enum(["all", "any"]), conditions: conditions.min(1) })
  .meta({ id: "NonEmptyCriteriaRule" });

export const CriterionDefinition = z
  .object({
    id: z.string(),
    /** Phrase keys. */
    label: z.string(),
    description: z.string(),
    /** The label in the viewer's language; a readable form of the id when there is no phrase. */
    title: z.string(),
    /** The description in the viewer's language; empty when there is no phrase. */
    help: z.string(),
    /**
     * How the condition is read: a minimum, a maximum, a limit the value stays below, yes/no (1 =
     * must hold), a shop item id (all in `value`), a list of group or member ids (`ids`), or a
     * list of other ids with no number (`ids`).
     */
    kind: z.enum(["atLeast", "atMost", "below", "boolean", "item", "groups", "members", "ids"]),
    unit: z.enum(["count", "days", "points", "boolean", "item", "groups", "members", "ids"]),
    /** What the ids of a list name; null when the criterion takes no list. */
    idKind: z.enum(CRITERION_ID_KINDS).nullable(),
    /** Whether the condition may look back over a window of `days`; without one it counts all time. */
    window: z.boolean(),
    /** How the condition may read its list, the first being the default; empty when it has no mode. */
    modes: z.array(z.enum(CRITERION_MODES)),
    /**
     * `cheap` criteria read the member's own row or one indexed lookup and may be checked while
     * a request is served; `background` ones only run in background checks (promotions, awards).
     */
    cost: z.enum(["cheap", "background"]),
  })
  .meta({ id: "CriterionDefinition" });

export const criteriaList = defineContract({
  name: "criteria.list",
  summary:
    "Everything a rule editor needs: every criterion a rule can use (the same list as " +
    "promotions.criteria and awards.criteria) and the groups, awards and credit rules a rule may " +
    "name, by id and title. " +
    "Requires any of admin.promotions, admin.awards, admin.shop, admin.announcements or " +
    "admin.reactionTypes, the permissions of the places that hold a rule.",
  kind: "read",
  input: Empty,
  output: z.object({
    items: z.array(CriterionDefinition),
    groups: z.array(z.object({ id: Id, title: z.string() })),
    awards: z.array(z.object({ id: Id, title: z.string() })),
    creditRules: z.array(z.object({ id: Id, title: z.string() })),
  }),
});
