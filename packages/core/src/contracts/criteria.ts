import * as z from "zod";
import { Id } from "./common";

/**
 * One condition of a rule. `criterion` is an id from the criteria registry; which of `value`
 * and `ids` it takes depends on the criterion (see `CriterionDefinition.kind`): a threshold or
 * 1/0 for yes/no criteria in `value`, or a list of group or member ids in `ids`. The server
 * refuses a condition that lacks what its criterion needs.
 */
export const CriteriaCondition = z
  .object({
    criterion: z.string().min(1).max(50),
    value: z.number().int().min(0).max(1_000_000_000).optional(),
    ids: z.array(Id).min(1).max(500).optional(),
  })
  .meta({ id: "CriteriaCondition" });

const conditions = z.array(CriteriaCondition).max(20);

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
     * must hold), a shop item id (all in `value`), or a list of group or member ids (`ids`).
     */
    kind: z.enum(["atLeast", "atMost", "below", "boolean", "item", "groups", "members"]),
    unit: z.enum(["count", "days", "points", "boolean", "item", "groups", "members"]),
    /**
     * `cheap` criteria read the member's own row or one indexed lookup and may be checked while
     * a request is served; `background` ones only run in background checks (promotions, awards).
     */
    cost: z.enum(["cheap", "background"]),
  })
  .meta({ id: "CriterionDefinition" });
