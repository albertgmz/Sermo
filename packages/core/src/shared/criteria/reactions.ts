import type { Ctx } from "../../context";
import type { DomainEvent } from "../../events";
import { listed, withValue } from "./build";
import { type Spec, scalarOf } from "./types";

/** The member who reacted is the one whose count of reactions given grew; the receiver is followed already. */
const giver = (_ctx: Ctx, event: DomainEvent) => [Number(event.payload.userId)];

/** Reactions given and received, and the best reacted post. */
export const reactionSpecs: readonly Spec[] = [
  // The reactions the member gave of the listed types. Both statements are answered from an
  // index on (member, type) alone.
  listed(
    "reactions_given_by_type",
    "reactionTypes",
    {
      shape: "perId",
      sql:
        "SELECT user_id, reaction_type_id AS id, count(*) AS n FROM reactions INDEXED BY reactions_user_type " +
        "WHERE user_id IN (SELECT value FROM json_each(?1)) AND reaction_type_id IN (SELECT value FROM json_each(?2)) " +
        "GROUP BY user_id, reaction_type_id",
    },
    {
      modes: ["all", "one", "each"],
      value: true,
      refresh: { on: ["reaction.added"], members: giver },
    },
  ),
  // The reactions the member's content received of the listed types.
  listed(
    "reactions_received_by_type",
    "reactionTypes",
    {
      shape: "perId",
      sql:
        "SELECT content_user_id AS user_id, reaction_type_id AS id, count(*) AS n FROM reactions INDEXED BY reactions_recipient_type " +
        "WHERE content_user_id IN (SELECT value FROM json_each(?1)) AND reaction_type_id IN (SELECT value FROM json_each(?2)) " +
        "GROUP BY content_user_id, reaction_type_id",
    },
    { modes: ["all", "one", "each"], value: true },
  ),
  // The reaction total of the member's best visible post (in a visible thread), found by one seek
  // into the partial index of posts that have reactions. The reacted author is followed already.
  withValue(
    "most_reacted_post",
    "atLeast",
    "count",
    "measure",
    (facts, value) => scalarOf(facts, { criterion: "most_reacted_post" }) >= value,
    "cheap",
    false,
    {
      shape: "scalar",
      sql:
        "SELECT m.value AS user_id, NULL AS id, (SELECT p.reaction_total FROM posts p INDEXED BY posts_user_reactions " +
        "CROSS JOIN threads t ON t.id = p.thread_id " +
        "WHERE p.user_id = m.value AND p.reaction_total > 0 AND p.state = 'visible' AND t.state = 'visible' " +
        "ORDER BY p.reaction_total DESC LIMIT 1) AS n FROM json_each(?1) m",
    },
  ),
];
