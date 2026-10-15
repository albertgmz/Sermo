import type { Ctx } from "../../context";
import { prepared } from "../../context";
import type { DomainEvent } from "../../events";
import { counted, withValue } from "./build";
import { DAY, measureKey, type Spec } from "./types";

const LAST_POST = measureKey({ criterion: "days_since_last_post" });
const MENTIONABLE = ["post", "profile_post", "profile_post_comment"];

/**
 * One branch of the count of mentions: the mentioning content must be another member's, and
 * visible (a post also in a visible thread: hiding a thread leaves its posts' own state alone).
 */
const mentionsIn = (type: string, table: string, inThread = false) =>
  `SELECT m.user_id AS user_id, NULL AS id, count(*) AS n FROM content_mentions m INDEXED BY content_mentions_user ` +
  `JOIN ${table} c ON c.id = m.content_id ${inThread ? "JOIN threads t ON t.id = c.thread_id " : ""}` +
  `WHERE m.content_type = '${type}' AND m.user_id IN (SELECT value FROM json_each(?1)) ` +
  `AND c.state = 'visible' ${inThread ? "AND t.state = 'visible' " : ""}AND c.user_id != m.user_id GROUP BY m.user_id`;

/** Whoever a new or edited piece of content mentions. */
function mentionedIn(ctx: Ctx, event: DomainEvent): number[] {
  if (!MENTIONABLE.includes(event.targetType)) return [];
  return prepared(ctx, "shared.criteriaMentioned", () =>
    ctx.sqlite.prepare<{ user_id: number }, [string, number]>(
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2",
    ),
  )
    .all(event.targetType, event.targetId)
    .map((row) => row.user_id);
}

/**
 * How a member takes part, beyond what they have written. These walk the member's posts or the
 * mentions of them, so they only run in background checks.
 */
export const engagementSpecs: readonly Spec[] = [
  // The newest visible post of a visible thread is the member's last id in `posts_user_id`,
  // found by one seek per member. A member who has never posted does not hold it: there is no
  // post to be long ago, and every new account would hold it at once.
  withValue(
    "days_since_last_post",
    "atLeast",
    "days",
    "measure",
    (f, v) => {
      const last = f.measures.get(LAST_POST);
      return typeof last === "number" && f.now - last >= v * DAY;
    },
    "background",
    false,
    {
      shape: "scalar",
      sql:
        "SELECT m.value AS user_id, NULL AS id, (SELECT p.created_at FROM posts p INDEXED BY posts_user_id " +
        "JOIN threads t ON t.id = p.thread_id " +
        "WHERE p.user_id = m.value AND p.state = 'visible' AND t.state = 'visible' ORDER BY p.id DESC LIMIT 1) AS n FROM json_each(?1) m",
    },
  ),
  // Mentions of the member in other members' visible posts, profile posts and profile comments.
  counted(
    "mentioned_by_others",
    {
      shape: "scalar",
      sql: [
        mentionsIn("post", "posts", true),
        mentionsIn("profile_post", "profile_posts"),
        mentionsIn("profile_post_comment", "profile_post_comments"),
      ].join(" UNION ALL "),
    },
    { refresh: { on: ["content.created", "content.edited"], members: mentionedIn } },
  ),
];
