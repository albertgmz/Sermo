import type { AcceptedVersions, Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ACCEPTANCE_REQUIRED_MESSAGE, ACCEPTANCE_REQUIRED_PATH } from "../../contracts/terms";
import { ACCEPTANCE_KINDS, type AcceptanceKind } from "../../db/schema";
import { ForbiddenError } from "../../errors";
import { markPublic } from "../../operation";
import { parseAddress } from "../security/address";

/*
 * Which version of the terms page and the rules page a member has to have accepted. The version
 * belongs to the static page (`static_pages.version`, raised on purpose by `pages.save`); a page
 * that is missing or unpublished asks nothing. One row per acceptance lives in
 * `terms_acceptances`.
 */

export type PublishedVersions = Record<AcceptanceKind, number | null>;

export const acceptanceSql = {
  published:
    "SELECT slug, version FROM static_pages WHERE slug IN ('terms', 'rules') AND is_published = 1",
  newest:
    "SELECT kind, MAX(version) AS version FROM terms_acceptances WHERE user_id = ?1 GROUP BY kind",
  insert:
    "INSERT OR IGNORE INTO terms_acceptances (user_id, kind, version, ip, accepted_at) VALUES (?1, ?2, ?3, ?4, ?5)",
  // Newest first, so the latest acceptance of each kind is always among the rows read.
  member:
    "SELECT kind, version, ip, accepted_at FROM terms_acceptances WHERE user_id = ?1 ORDER BY accepted_at DESC, version DESC LIMIT 100",
  highest: "SELECT COALESCE(MAX(version), 0) AS version FROM terms_acceptances WHERE kind = ?1",
  erase: "DELETE FROM terms_acceptances WHERE user_id = ?1",
  /** The two newest-version columns the actor lookup adds to its member row. */
  newestColumns:
    "(SELECT MAX(version) FROM terms_acceptances WHERE user_id = u.id AND kind = 'terms') AS accepted_terms, " +
    "(SELECT MAX(version) FROM terms_acceptances WHERE user_id = u.id AND kind = 'rules') AS accepted_rules",
};

/** The versions the site asks members to accept now; null for a page that is not published. */
export function publishedVersions(ctx: Ctx): PublishedVersions {
  const out: PublishedVersions = { terms: null, rules: null };
  const rows = prepared(ctx, "pages.acceptancePublished", () =>
    ctx.sqlite.prepare<{ slug: AcceptanceKind; version: number }, []>(acceptanceSql.published),
  ).all();
  for (const row of rows) out[row.slug] = row.version;
  return out;
}

/**
 * The version a page created now starts at: above every version a member accepted under its slug
 * (1 for a slug that is not an acceptance kind or was never accepted). Reads every acceptance of
 * the kind, so ask only when a page is created.
 */
export function startingVersion(ctx: Ctx, slug: string): number {
  if (!(ACCEPTANCE_KINDS as readonly string[]).includes(slug)) return 1;
  return (
    prepared(ctx, "pages.acceptanceHighest", () =>
      ctx.sqlite.prepare<{ version: number }, [string]>(acceptanceSql.highest),
    ).get(slug)!.version + 1
  );
}

/** The newest version of each kind the member holds a record for (0 = none). */
export function acceptedVersions(ctx: Ctx, userId: number): AcceptedVersions {
  const out = { terms: 0, rules: 0 };
  const rows = prepared(ctx, "pages.acceptanceNewest", () =>
    ctx.sqlite.prepare<{ kind: AcceptanceKind; version: number }, [number]>(acceptanceSql.newest),
  ).all(userId);
  for (const row of rows) out[row.kind] = row.version;
  return out;
}

/** What the actor read with its member row (see `auth.member`) as `AcceptedVersions`. */
export const acceptedFromRow = (row: {
  accepted_terms: number | null;
  accepted_rules: number | null;
}): AcceptedVersions => ({ terms: row.accepted_terms ?? 0, rules: row.accepted_rules ?? 0 });

/**
 * The published pages a member has not accepted at their current version, in `ACCEPTANCE_KINDS`
 * order. Guests are asked nothing. With nothing published this is one indexed read; the
 * member's own versions come with the actor (a hand-built actor has them looked up).
 */
export const pendingAcceptances = markPublic(
  "Reports what a member still has to accept; it grants and refuses nothing.",
  (ctx: Ctx, actor: Actor): { kind: AcceptanceKind; version: number }[] => {
    if (actor.kind === "guest") return [];
    const published = publishedVersions(ctx);
    if (published.terms === null && published.rules === null) return [];
    const accepted = actor.acceptance ?? acceptedVersions(ctx, actor.userId);
    const pending: { kind: AcceptanceKind; version: number }[] = [];
    for (const kind of ACCEPTANCE_KINDS) {
      const version = published[kind];
      if (version !== null && accepted[kind] < version) pending.push({ kind, version });
    }
    return pending;
  },
);

/**
 * Refuses a write that posts, reacts or messages when the member has not accepted the current
 * terms and rules: a `forbidden` error whose issue path is `acceptance`. Call it right after the
 * operation's own permission check, before any transaction. A guest passes (the operation's own
 * account check refuses them); an API key acts as its member and is refused the same way.
 */
export const requireTermsAccepted = markPublic(
  "Refuses a member who has not accepted the current terms; it is not a permission.",
  (ctx: Ctx, actor: Actor): void => {
    const pending = pendingAcceptances(ctx, actor);
    if (pending.length === 0) return;
    throw new ForbiddenError(ACCEPTANCE_REQUIRED_MESSAGE, [
      { path: [ACCEPTANCE_REQUIRED_PATH], message: pending.map((item) => item.kind).join(",") },
    ]);
  },
);

/**
 * Records that the member accepted these versions now. Already recorded versions are left as they
 * are. Call it inside a write transaction. `ip` is the trusted client address as the request
 * carried it; it is stored normalised, or as null when it is not an address.
 */
export function insertAcceptances(
  ctx: Ctx,
  userId: number,
  items: readonly { kind: AcceptanceKind; version: number }[],
  ip: string | null | undefined,
): void {
  const address = parseAddress(ip)?.ip ?? null;
  const insert = prepared(ctx, "pages.acceptanceInsert", () =>
    ctx.sqlite.prepare<unknown, [number, string, number, string | null, number]>(
      acceptanceSql.insert,
    ),
  );
  for (const item of items) insert.run(userId, item.kind, item.version, address, ctx.now());
}

/** Records the versions published now as accepted by a member who has just signed up. */
export function recordSignUpAcceptance(
  ctx: Ctx,
  userId: number,
  ip: string | null | undefined,
): void {
  const published = publishedVersions(ctx);
  const items = ACCEPTANCE_KINDS.flatMap((kind) => {
    const version = published[kind];
    return version === null ? [] : [{ kind, version }];
  });
  insertAcceptances(ctx, userId, items, ip);
}
