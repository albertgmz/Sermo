import * as z from "zod";
import { defineContract } from "../operation";
import { Empty, Id, Timestamp } from "./common";

/**
 * The categories of cookie a visitor may switch. The strictly necessary ones are always on and
 * are not recorded.
 */
export const CONSENT_CATEGORIES = ["analytics", "referrals", "embeds"] as const;

export const ConsentCategory = z.enum(CONSENT_CATEGORIES);

/** The highest cookie policy version: `consent.askAgain` stops there. */
export const MAX_COOKIE_POLICY_VERSION = 1_000_000;

/** The version of the cookie policy a choice answers: a positive whole number. */
const PolicyVersion = z.number().int().min(1).max(MAX_COOKIE_POLICY_VERSION);

export const ConsentRecord = z
  .object({
    /** The optional categories the member accepted; empty when they refused all. */
    categories: z.array(ConsentCategory).max(CONSENT_CATEGORIES.length),
    /** The version of the cookie policy the member answered. */
    policyVersion: PolicyVersion,
    /** When the member made this choice. */
    decidedAt: Timestamp,
  })
  .meta({ id: "ConsentRecord" });

export const consentMine = defineContract({
  name: "consent.mine",
  summary:
    "The signed-in member's saved cookie choice, or null when they never saved one. The record " +
    "may answer an older policy version than the site's current one (`site.get` " +
    "`cookiePolicyVersion`): a client treats such a choice as none and asks again. Members only.",
  kind: "read",
  input: Empty,
  output: z.object({ record: ConsentRecord.nullable() }),
});

export const consentSave = defineContract({
  name: "consent.save",
  summary:
    "Save the signed-in member's cookie choice on their account, replacing the previous one: " +
    "the optional categories accepted (none to refuse all) and the policy version answered, " +
    "stamped with `decidedAt`, the time the member made the choice (the banner's own record of it), " +
    "else the time of the call; a `decidedAt` later than the call is replaced by the time of the call. The version must be the site's current one " +
    "(`site.get` `cookiePolicyVersion`); a choice made under an older text is a conflict. " +
    "Members only.",
  kind: "write",
  input: z.object({
    categories: z
      .array(ConsentCategory)
      .max(CONSENT_CATEGORIES.length)
      .refine((list) => new Set(list).size === list.length, "Name each category once."),
    policyVersion: PolicyVersion,
    decidedAt: Timestamp.optional(),
  }),
  output: z.object({ record: ConsentRecord }),
});

export const consentBanner = defineContract({
  name: "consent.banner",
  summary:
    "Whether the cookie banner is to be shown to this visitor. Always true when the site shows " +
    "it to everyone (the default), when the visitor's country is not known, or when it is in " +
    "the EU, the EEA, the United Kingdom or Switzerland. The country comes only from the " +
    "trusted location the proxy reports (see the location headers of the deployment); " +
    "nothing the client sends counts. Open to everyone.",
  kind: "read",
  input: Empty,
  output: z.object({ show: z.boolean() }),
});

export const consentAskAgain = defineContract({
  name: "consent.askAgain",
  summary:
    "Raise the cookie policy version by one, so every visitor and member is asked for their " +
    "cookie choice again; saved choices of older versions stop counting. The version is " +
    "changed only by this call, never by `settings.update`. Requires admin.settings.",
  kind: "write",
  input: Empty,
  output: z.object({ policyVersion: PolicyVersion }),
});

export const usersConsent = defineContract({
  name: "users.consent",
  summary:
    "A member's saved cookie choice, for staff who must show it (null when none was saved, " +
    "and for an erased member). Read only. Requires admin.members over the member.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({ record: ConsentRecord.nullable() }),
});
