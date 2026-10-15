import type * as z from "zod";
import type { Ctx } from "../../context";
import type {
  CRITERION_ID_KINDS,
  CRITERION_MODES,
  CriteriaCondition,
  CriteriaRule,
} from "../../contracts/criteria";
import type { DomainEvent, EventType } from "../../events";

export type Rule = z.infer<typeof CriteriaRule>;
export type Condition = z.infer<typeof CriteriaCondition>;
export type CostClass = "cheap" | "background";
export type Mode = (typeof CRITERION_MODES)[number];
export type IdKind = (typeof CRITERION_ID_KINDS)[number];

/** What a member's facts are loaded from: one query per source, only when a condition asks. */
export type Source = "none" | "member" | "warnings" | "purchases" | "groups" | "measure";

/**
 * What a measured criterion read about a member for one condition: a number, or a number per id
 * of the condition's list. Nothing found is 0 (and, for `days_since_last_post`, no entry).
 */
export type Measure = number | Map<number, number>;

/** Everything the registry's criteria read about one member (or a guest). */
export interface Facts {
  /** Null for a guest, who has no row, groups or history. */
  memberId: number | null;
  /** Epoch ms the facts are judged at. */
  now: number;
  postCount: number;
  createdAt: number;
  reactionScore: number;
  emailVerified: boolean;
  hasAvatar: boolean;
  lastActivityAt: number | null;
  credits: number;
  purchaseCount: number;
  /** Unexpired warning points. */
  warningPoints: number;
  /** Of the shop items some condition asks about, the ones the member bought. */
  purchasedItemIds: ReadonlySet<number>;
  /** Every group the member holds: primary, assigned by hand, granted by a promotion or bought. */
  groupIds: ReadonlySet<number>;
  hasCover: boolean;
  hasNameColor: boolean;
  hasAccentColor: boolean;
  hasFrame: boolean;
  /** Of Discord, Telegram and X, how many handles are filled in. */
  socialLinkCount: number;
  /** Avatar, about text, location and birthday are all set. */
  profileComplete: boolean;
  /** When the username last changed; null if never. */
  usernameChangedAt: number | null;
  restrictedPosting: boolean;
  restrictedConversations: boolean;
  restrictedProfilePosts: boolean;
  referralCount: number;
  wasReferred: boolean;
  /** Awards held, each grant counting, and the XP of those grants. */
  awardCount: number;
  awardXp: number;
  /** Tags the member has put on threads that still carry them. */
  tagCount: number;
  /** The measures of the conditions the loader was asked about, by `measureKey`. */
  measures: Map<string, Measure>;
}

export const DAY = 86_400_000;

/**
 * How a measured criterion is read from the database: one statement per condition for a page of
 * members. The statement's parameters are fixed: `?1` the JSON list of member ids, `?2` the
 * JSON list of the condition's ids, `?3` the start of its window in epoch ms (0 without one),
 * `?4` now and `?5` the start of the current month (UTC). It uses the ones it needs. Rows are
 * `{ user_id, id, n }`: `id` names the list entry a `perId` measure counts (null for a scalar
 * one).
 */
export interface Measurer {
  shape: "scalar" | "perId";
  sql: string;
}

export interface Spec {
  id: string;
  kind: "atLeast" | "atMost" | "below" | "boolean" | "item" | "groups" | "members" | "ids";
  unit: "count" | "days" | "points" | "boolean" | "item" | "groups" | "members" | "ids";
  /** What the condition carries; anything else is refused. */
  takes: {
    value: boolean;
    ids: IdKind | null;
    window: boolean;
    /** The first is the default. */
    modes: readonly Mode[];
  };
  cost: CostClass;
  source: Source;
  /** Whether a guest can satisfy it; every other criterion is false for a guest. */
  guests: boolean;
  /** Set where `source` is `measure`. */
  measure?: Measurer;
  /**
   * The members whose fact this event may have changed, so a background consumer can check them
   * at once instead of at the next sweep. Only for events the consumers do not already follow
   * (the author of new content, the recipient of a reaction, warnings, credits, a buyer, groups
   * and profile edits); a fact that no event tells of is left to the sweep.
   */
  refresh?: { on: readonly EventType[]; members: (ctx: Ctx, event: DomainEvent) => number[] };
  holds(facts: Facts, condition: Condition): boolean;
}

/**
 * What identifies a measurement: the criterion, its ids and its window. The threshold and the
 * mode do not change what is measured, so conditions that differ only in them share a query.
 */
export function measureKey(condition: Condition): string {
  const ids = [...new Set(condition.ids ?? [])].sort((a, b) => a - b);
  return `${condition.criterion}|${ids.join(",")}|${condition.days ?? 0}`;
}

const NONE: ReadonlyMap<number, number> = new Map();

/** The number a scalar measure holds for a condition (0 when nothing was found). */
export function scalarOf(facts: Facts, condition: Condition): number {
  const measure = facts.measures.get(measureKey(condition));
  return typeof measure === "number" ? measure : 0;
}

/** The numbers a per-id measure holds for a condition. */
export function perIdOf(facts: Facts, condition: Condition): ReadonlyMap<number, number> {
  const measure = facts.measures.get(measureKey(condition));
  return measure instanceof Map ? measure : NONE;
}

/**
 * Whether a list of counts meets a threshold in the condition's mode: `one` when any listed id
 * does, `each` when all do, `all` when the counts added together do, `none` when no id does.
 * A condition with no threshold asks for at least 1.
 */
export function listHolds(
  counts: ReadonlyMap<number, number>,
  condition: Condition,
  mode: Mode,
): boolean {
  const ids = [...new Set(condition.ids ?? [])];
  const need = condition.value ?? 1;
  const count = (id: number) => counts.get(id) ?? 0;
  switch (mode) {
    case "each":
      return ids.every((id) => count(id) >= need);
    case "all":
      return ids.reduce((sum, id) => sum + count(id), 0) >= need;
    case "none":
      return ids.every((id) => count(id) < need);
    default:
      return ids.some((id) => count(id) >= need);
  }
}
