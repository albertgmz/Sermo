import * as z from "zod";
import { ACCEPTANCE_KINDS } from "../db/schema";
import { defineContract } from "../operation";
import { MemberOutcomes } from "./batch";
import { ActorPassword, Id, Page, pageInput, Timestamp, UserSummary } from "./common";

/*
 * The sign-up approval queue. While the site setting `approveSignups` is on, a new account
 * (once its email is confirmed, where confirmation is required) waits here until staff decide.
 * An account that waits reads what a guest reads and takes no write: every operation that is
 * not marked public is refused with a `forbidden` error whose issue path is `approval`. It can
 * sign in, sign out, accept the terms and manage its credentials.
 */

export { APPROVAL_PENDING_MESSAGE, APPROVAL_PENDING_PATH } from "../approval";

/** What rejecting a sign-up does to the account. */
export const SIGNUP_REJECT_MODES = ["delete", "ban"] as const;

/** The most sign-ups one decision may name. */
export const MAX_SIGNUP_DECISIONS = 50;

export const SignupEntry = z
  .object({
    user: UserSummary,
    /** The address, or a masked form of it (j***@example.com) when `emailHidden`. */
    email: z.string(),
    /** The viewer does not manage members (admin.members over the account): the address is masked. */
    emailHidden: z.boolean(),
    createdAt: Timestamp,
    /**
     * A rejection by erasure stopped part way: the account is closed but not yet empty. Only
     * rejecting it by erasing again finishes it; approving or banning it is refused.
     */
    erasureStopped: z.boolean(),
    /** The spam check flagged the sign-up. A flagged account is never approved automatically. */
    flagged: z.boolean(),
    /** ISO 3166-1 alpha-2 country the sign-up came from, when the log knows it. */
    country: z.string().nullable(),
    /** The address it signed up from; null unless the viewer holds member.viewIps over it. */
    ip: z.string().nullable(),
    /**
     * The other accounts seen on the same address (an IPv6 address by its /64), from the IP log:
     * how many, how many of them are banned, and the newest few (the newest 20 on the address are
     * looked at). Null unless the viewer holds
     * member.viewIps over the account; accounts the viewer does not outrank are left out.
     */
    sharedAddress: z
      .object({
        accounts: z.number().int().nonnegative(),
        banned: z.number().int().nonnegative(),
        members: z.array(UserSummary),
      })
      .nullable(),
    /** The newest version of the terms and the rules the account accepted, and when. */
    acceptances: z.array(
      z.object({
        kind: z.enum(ACCEPTANCE_KINDS),
        version: z.number().int().positive(),
        acceptedAt: Timestamp,
      }),
    ),
  })
  .meta({ id: "SignupEntry" });

export const signupsList = defineContract({
  name: "signups.list",
  summary:
    "The accounts waiting for approval, newest first, with what helps decide: username, email, " +
    "when it signed up, whether the spam check flagged it, the country and (with member.viewIps) " +
    "the address and the other accounts seen on it, and the terms it accepted. Only confirmed " +
    "accounts are listed (an account that has not confirmed its email is not waiting for staff " +
    "yet), and neither are the ones a ban holds back: a rejected one banned for good is closed, one " +
    "banned for a time returns when the ban ends (an account whose erasure stopped part way stays " +
    "listed, `erasureStopped`, so staff can finish it). The email is masked unless the viewer holds " +
    "admin.members over the account. Requires member.approveRegistrations.",
  kind: "read",
  input: z.object({ ...pageInput }),
  output: Page(SignupEntry),
});

export const signupsDecide = defineContract({
  name: "signups.decide",
  summary:
    "Approve or reject accounts that wait for approval, up to 50 at a time, one by one: an " +
    "account that is no longer waiting, or that the actor may not act on, is skipped and " +
    "reported, and does not stop the rest. Approving lets the account act as the member it is " +
    "and emails it. Rejecting emails it the reason, if one was given, and either bans the " +
    "account (`mode` `ban`, the default: the ban is the actor's own, so it needs member.ban " +
    "over the account and is bounded by member.banMaxDays like `bans.create`: `banDays` null " +
    "bans for good and needs -1, otherwise the days may not exceed the bound; a ban for good " +
    "closes the account, a ban for a time keeps it held and out of the queue until the ban " +
    "ends) or erases it (`mode` `delete`: the erasure of `users.adminErase`, so it needs " +
    "admin.members over the account, as erasing a member does, and the actor's own password, " +
    "session actors only; an erasure that stopped part way is finished by deciding again). " +
    "Banning keeps the sign-up address and the terms record the queue shows for the next " +
    "account; erasing removes them. Each account changed is one moderator log entry " +
    "(`signup.approve`, `signup.reject`). Requires member.approveRegistrations over the account.",
  kind: "write",
  input: z.object({
    userIds: z.array(Id).min(1).max(MAX_SIGNUP_DECISIONS),
    decision: z.enum(["approve", "reject"]),
    /** Sent to the member in the email; kept in the log. Optional. */
    reason: z.string().trim().max(1000).default(""),
    /** What rejecting does; ignored when approving. */
    mode: z.enum(SIGNUP_REJECT_MODES).default("ban"),
    /** The length of a reject ban in days; null bans for good. Ignored unless banning. */
    banDays: z.number().int().min(1).max(3650).nullable().default(null),
    actorPassword: ActorPassword.optional(),
  }),
  output: MemberOutcomes,
});
