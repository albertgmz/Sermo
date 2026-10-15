import {
  MAX_CONDITION_DAYS,
  MAX_CONDITION_IDS,
  MAX_CONDITION_VALUE,
  MAX_RULE_CONDITIONS,
} from "@sermo/core/contracts";
import type { Criterion, RuleLimits } from "@/components/staff/criteria-rule";

// The limits of the shared schema, as the builder is given them.
export const LIMITS: RuleLimits = {
  conditions: MAX_RULE_CONDITIONS,
  value: MAX_CONDITION_VALUE,
  ids: MAX_CONDITION_IDS,
  days: MAX_CONDITION_DAYS,
};

type Kind = Criterion["kind"];
type Unit = Criterion["unit"];

// The criteria the backend answers with a measure of the member's history.
const MEASURED = new Set([
  "posts_in_threads",
  "replies_received",
  "busiest_thread_replies",
  "profile_posts_written",
  "profile_comments_written",
  "attachments_uploaded",
  "bookmarks_at_least",
  "watching_forums_at_least",
  "watching_threads_at_least",
  "owns_item",
  "wears_item",
  "bought_in_category",
  "gifted_items",
  "credits_earned",
  "credits_from_rule",
  "holds_awards",
  "thread_banned",
  "banned_before",
]);

const entry = (
  id: string,
  kind: Kind,
  unit: Unit,
  more: Partial<Criterion> = {},
): Criterion => ({
  id,
  kind,
  unit,
  cost: "cheap",
  idKind: null,
  window: false,
  modes: [],
  measured: MEASURED.has(id),
  title: `Title of ${id}`,
  help: `Help for ${id}`,
  ...more,
});

// The backend's registry as `criteria.list` gives it, in its order: every criterion with its kind,
// unit, cost class, and what a condition may carry (a list of ids, a window, modes).
export const CRITERIA: Criterion[] = [
  entry("post_count", "atLeast", "count"),
  entry("days_registered", "atLeast", "days"),
  entry("reaction_score", "atLeast", "points"),
  entry("email_verified", "boolean", "boolean"),
  entry("has_avatar", "boolean", "boolean"),
  entry("active_within_days", "atMost", "days"),
  entry("inactive_days", "atLeast", "days"),
  entry("warning_points_below", "below", "points", { cost: "background" }),
  entry("credits_at_least", "atLeast", "count"),
  entry("credits_at_most", "atMost", "count"),
  entry("purchased_item", "item", "item"),
  entry("purchases_at_least", "atLeast", "count"),
  entry("is_guest", "boolean", "boolean"),
  entry("in_group", "groups", "groups", { idKind: "groups" }),
  entry("not_in_group", "groups", "groups", { idKind: "groups" }),
  entry("is_member", "members", "members", { idKind: "members" }),
  entry("posts_in_threads", "atLeast", "count", {
    cost: "background",
    idKind: "threads",
    modes: ["each", "one", "all"],
  }),
  entry("replies_received", "atLeast", "count", { cost: "background" }),
  entry("busiest_thread_replies", "atLeast", "count", { cost: "background" }),
  entry("profile_posts_written", "atLeast", "count", { cost: "background" }),
  entry("profile_comments_written", "atLeast", "count", { cost: "background" }),
  entry("attachments_uploaded", "atLeast", "count", { cost: "background" }),
  entry("bookmarks_at_least", "atLeast", "count", { cost: "background" }),
  entry("watching_forums_at_least", "atLeast", "count", { cost: "background" }),
  entry("watching_threads_at_least", "atLeast", "count", {
    cost: "background",
  }),
  entry("owns_item", "ids", "ids", {
    idKind: "shopItems",
    modes: ["one", "each"],
  }),
  entry("wears_item", "ids", "ids", {
    idKind: "shopItems",
    modes: ["one", "each"],
  }),
  entry("bought_in_category", "ids", "ids", {
    idKind: "shopCategories",
    modes: ["one", "each"],
  }),
  entry("gifted_items", "atLeast", "count", { cost: "background" }),
  entry("credits_earned", "atLeast", "count", {
    cost: "background",
    window: true,
  }),
  entry("credits_from_rule", "atLeast", "count", {
    cost: "background",
    idKind: "creditRules",
    window: true,
    modes: ["all", "one", "each"],
  }),
  entry("awards_held_at_least", "atLeast", "count"),
  entry("award_xp_at_most", "atMost", "points"),
  entry("holds_awards", "ids", "ids", {
    idKind: "awards",
    modes: ["one", "none", "each"],
  }),
  entry("has_cover", "boolean", "boolean"),
  entry("has_name_color", "boolean", "boolean"),
  entry("has_accent_color", "boolean", "boolean"),
  entry("has_frame", "boolean", "boolean"),
  entry("social_links_at_least", "atLeast", "count"),
  entry("profile_complete", "boolean", "boolean"),
  entry("username_changed_within_days", "atMost", "days"),
  entry("restricted_posting", "boolean", "boolean"),
  entry("restricted_conversations", "boolean", "boolean"),
  entry("restricted_profile_posts", "boolean", "boolean"),
  entry("thread_banned", "boolean", "boolean"),
  entry("banned_before", "boolean", "boolean"),
  entry("reports_resolved", "atLeast", "count", { cost: "background" }),
  entry("moderator_actions", "atLeast", "count", { cost: "background" }),
  entry("days_since_last_post", "atLeast", "days", { cost: "background" }),
  entry("mentioned_by_others", "atLeast", "count", { cost: "background" }),
  entry("referrals_at_least", "atLeast", "count"),
  entry("was_referred", "boolean", "boolean"),
  entry("referrals_this_month", "atLeast", "count", { cost: "background" }),
];

// The same list as the backend sends it, with the phrase keys the web ignores.
export const CRITERIA_BODY = CRITERIA.map((criterion) => ({
  ...criterion,
  label: `criterion.${criterion.id}`,
  description: `criterion.${criterion.id}.description`,
}));
