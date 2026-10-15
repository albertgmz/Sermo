import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import {
  CONSENT_CATEGORIES,
  consentAskAgain,
  consentBanner,
  consentMine,
  consentSave,
  MAX_COOKIE_POLICY_VERSION,
  usersConsent,
} from "../../contracts/consent";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError } from "../../errors";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { targetMember } from "../admin/shared";
import { appendModeratorLog } from "../moderation";
import { readSiteSettings, storeSiteSettings } from "../settings";
import { inConsentRegion } from "./regions";

interface RecordRow {
  categories: string;
  policy_version: number;
  decided_at: number;
}

export const consentSql = {
  read: "SELECT categories, policy_version, decided_at FROM consent_records WHERE user_id = ?1",
  save: "INSERT INTO consent_records (user_id, categories, policy_version, decided_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id) DO UPDATE SET categories = excluded.categories, policy_version = excluded.policy_version, decided_at = excluded.decided_at",
  erase: "DELETE FROM consent_records WHERE user_id = ?1",
  erased: "SELECT erased_at FROM users WHERE id = ?1",
};

function recordOf(row: RecordRow) {
  const stored = JSON.parse(row.categories) as string[];
  return {
    categories: CONSENT_CATEGORIES.filter((category) => stored.includes(category)),
    policyVersion: row.policy_version,
    decidedAt: iso(row.decided_at),
  };
}

/** A member's saved cookie choice; null when they never saved one. */
export function readConsentRecord(ctx: Ctx, userId: number) {
  const row = prepared(ctx, "consent.read", () =>
    ctx.sqlite.prepare<RecordRow, [number]>(consentSql.read),
  ).get(userId);
  return row ? recordOf(row) : null;
}

/** Removes a member's saved cookie choice (erasing the member), inside the caller's transaction. */
export function deleteConsentRecord(ctx: Ctx, userId: number): void {
  prepared(ctx, "consent.erase", () => ctx.sqlite.prepare(consentSql.erase)).run(userId);
}

export const operations = [
  implement(
    consentMine,
    (ctx, actor) => ({ record: readConsentRecord(ctx, requireAuthenticated(actor).userId) }),
    { public: "A member reads their own cookie choice; it needs an account, not a permission." },
  ),

  implement(
    consentSave,
    (ctx, actor, input) => {
      const { userId } = requireAuthenticated(actor);
      return writeTx(ctx, () => {
        // A choice answers the text the member saw; one made under a version since replaced would
        // put a version on record that never asked them.
        // An erased account keeps no record: a request resolved before the erasure ran must not
        // bring one back.
        if (
          prepared(ctx, "consent.erased", () =>
            ctx.sqlite.prepare<{ erased_at: number | null }, [number]>(consentSql.erased),
          ).get(userId)?.erased_at
        )
          throw new ForbiddenError("This account is closed.");
        const { cookiePolicyVersion } = readSiteSettings(ctx);
        if (input.policyVersion !== cookiePolicyVersion)
          throw new ConflictError("The cookie policy changed. Choose again.");
        const categories = CONSENT_CATEGORIES.filter((category) =>
          input.categories.includes(category),
        );
        prepared(ctx, "consent.save", () => ctx.sqlite.prepare(consentSql.save)).run(
          userId,
          JSON.stringify(categories),
          input.policyVersion,
          ctx.now(),
        );
        return { record: readConsentRecord(ctx, userId)! };
      });
    },
    { public: "A member saves their own cookie choice; it needs an account, not a permission." },
  ),

  implement(
    consentBanner,
    (ctx, actor) => {
      if (readSiteSettings(ctx).cookieBannerOutsideEu) return { show: true };
      // Only the country the trusted proxy reported counts; with none the banner is shown.
      const country = actor.clientLocation?.country ?? null;
      return { show: country === null || inConsentRegion(country) };
    },
    {
      public:
        "Whether the banner applies to a visitor is decided from the site's setting and the " +
        "trusted location of the request; it holds nothing private.",
    },
  ),

  implement(consentAskAgain, (ctx, actor) => {
    requirePermission(ctx, actor, "admin.settings");
    return writeTx(ctx, () => {
      requirePermission(ctx, currentActor(ctx, actor), "admin.settings");
      const current = readSiteSettings(ctx);
      if (current.cookiePolicyVersion >= MAX_COOKIE_POLICY_VERSION)
        throw new ConflictError("The cookie policy version cannot be raised any further.");
      const policyVersion = current.cookiePolicyVersion + 1;
      storeSiteSettings(ctx, { ...current, cookiePolicyVersion: policyVersion });
      appendModeratorLog(ctx, actor, "settings.update", "settings", 1, "", {
        changedKeys: ["cookiePolicyVersion"],
      });
      return { policyVersion };
    });
  }),

  implement(usersConsent, (ctx, actor, input) => {
    requireAuthenticated(actor);
    requirePermission(ctx, actor, "admin.members", {
      target: targetMember(ctx, actor, input.userId),
    });
    return { record: readConsentRecord(ctx, input.userId) };
  }),
];
