/**
 * The +18 mode: who may see content marked +18 (a forum and everything under it, a thread, a
 * profile). While the site setting `adultMode` is off nothing here hides anything. While it is
 * on, only an eligible member sees +18 content: one whose stored birth date (year and day) makes
 * them 18 or older, in UTC, and who has confirmed the warning. Guests, minors and members with no
 * full birth date never do. Forums are decided inside the permission check (an adult node is not
 * viewable); threads and profiles by the callers, through `adultRefusalFor`.
 */
import type { Actor } from "../actor";
import { type Ctx, prepared } from "../context";
import { AdultContentError, type AdultRefusal } from "../errors";

const MODE_SQL =
  "SELECT json_extract(value, '$.adultMode') AS mode FROM site_settings WHERE key = 'configuration'";
const VIEWER_SQL = "SELECT birth_year, birthday_md, adult_accepted_at FROM users WHERE id = ?1";

/** Whether the site's +18 mode is on (one indexed lookup of the stored configuration). */
export function adultModeOn(ctx: Ctx): boolean {
  const row = prepared(ctx, "adult.mode", () =>
    ctx.sqlite.prepare<{ mode: number | null }, []>(MODE_SQL),
  ).get();
  return row?.mode === 1;
}

/**
 * The instant (epoch ms) a member born on that date turns 18, by US rules in UTC: 18 years after
 * the birth date (someone born on 29 February turns 18 on 1 March of a year that has none). Null
 * without a full date.
 */
export function adultFrom(birthYear: number | null, monthDay: string | null): number | null {
  if (birthYear === null || monthDay === null) return null;
  const match = /^(\d{2})-(\d{2})$/.exec(monthDay);
  if (!match) return null;
  return Date.UTC(birthYear + 18, Number(match[1]) - 1, Number(match[2]));
}

export interface AdultFacts {
  birth_year: number | null;
  birthday_md: string | null;
  adult_accepted_at: number | null;
}

/** Why a member with these stored facts may not see +18 content at `now`; null when they may. */
export function memberAdultRefusal(facts: AdultFacts, now: number): AdultRefusal | null {
  const from = adultFrom(facts.birth_year, facts.birthday_md);
  if (from === null) return "birthDate";
  if (now < from) return "minor";
  return facts.adult_accepted_at === null ? "acceptance" : null;
}

/** The facts of member `userId` the +18 rules read; null for a member that does not exist. */
export function adultFacts(ctx: Ctx, userId: number): AdultFacts | null {
  return (
    prepared(ctx, "adult.viewer", () => ctx.sqlite.prepare<AdultFacts, [number]>(VIEWER_SQL)).get(
      userId,
    ) ?? null
  );
}

/** Why `actor` may not see +18 content whatever the mode says; null when they may. */
export function adultEligibility(ctx: Ctx, actor: Actor): AdultRefusal | null {
  if (actor.kind === "guest") return "guest";
  const facts = adultFacts(ctx, actor.userId);
  return facts ? memberAdultRefusal(facts, ctx.now()) : "birthDate";
}

/**
 * Why `actor` may not see +18 content now; null when they may (the mode is off, or they are
 * eligible). Callers resolve it once per request and hide or refuse what is marked.
 */
export function adultRefusalFor(ctx: Ctx, actor: Actor): AdultRefusal | null {
  return adultModeOn(ctx) ? adultEligibility(ctx, actor) : null;
}

/**
 * Throws the typed +18 refusal when `actor` may not see content marked +18 (`adult`) that belongs
 * to `ownerId`: what a member wrote or owns is always theirs to see.
 */
export function requireAdultView(
  ctx: Ctx,
  actor: Actor,
  adult: boolean,
  ownerId: number | null = null,
): void {
  if (!adult || (actor.kind !== "guest" && actor.userId === ownerId)) return;
  const refusal = adultRefusalFor(ctx, actor);
  if (refusal) throw new AdultContentError(refusal);
}
