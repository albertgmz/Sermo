import * as z from "zod";
import { ACCEPTANCE_KINDS } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Ok, Timestamp } from "./common";

/*
 * Accepting the terms page and the rules page. Each is a static page (slug `terms`, slug
 * `rules`) with a version that an administrator raises on purpose. A member who has not
 * accepted the current version of a published one cannot post, react or message until they do;
 * reading, their account pages and signing out stay open.
 */

/** The `path` of the issue that marks a refusal as "this member has to accept first". */
export const ACCEPTANCE_REQUIRED_PATH = "acceptance";

/** The message of a refusal for a missing acceptance (a `forbidden` error carrying the issue above). */
export const ACCEPTANCE_REQUIRED_MESSAGE =
  "You must accept the current terms and rules before you can do that.";

export const AcceptanceKind = z.enum(ACCEPTANCE_KINDS);

/** One published page the member has not accepted at its current version. */
export const PendingAcceptance = z
  .object({ kind: AcceptanceKind, version: z.number().int().positive() })
  .meta({ id: "PendingAcceptance" });

export const termsAccept = defineContract({
  name: "terms.accept",
  summary:
    "Accept the terms page, the rules page or both at the version the member was shown " +
    "(`auth.me` lists what is pending). Records one acceptance per kind with the time and the " +
    "trusted client address; repeating an acceptance changes nothing. A version that is no " +
    "longer the current one, or a page that is not published, is a conflict: read the pages " +
    "again. Requires a signed-in session: an API key cannot accept for its member (forbidden).",
  kind: "write",
  input: z.object({
    accept: z
      .array(PendingAcceptance)
      .min(1)
      .max(ACCEPTANCE_KINDS.length)
      .refine((items) => new Set(items.map((item) => item.kind)).size === items.length, {
        message: "Name each page once.",
      }),
  }),
  output: Ok,
});

export const MemberAcceptance = z
  .object({
    kind: AcceptanceKind,
    version: z.number().int().positive(),
    acceptedAt: Timestamp,
    ip: z.string().nullable(),
  })
  .meta({ id: "MemberAcceptance" });

export const usersAdminAcceptances = defineContract({
  name: "users.adminAcceptances",
  summary:
    "The versions of the terms and the rules a member accepted, newest first (at most 50 of each page; the latest of each is always listed): " +
    "kind, version, when, and the address recorded (null when none was recorded, when it was " +
    "dropped at the log retention age, or when the reader lacks member.viewIps over the " +
    "member), together with the versions the site publishes now (`current`, null for a page " +
    "that is not published), so the reader sees what is missing. Read-only. Requires admin.members over the member.",
  kind: "read",
  input: z.object({ userId: Id }),
  output: z.object({
    items: z.array(MemberAcceptance),
    current: z.object({
      terms: z.number().int().positive().nullable(),
      rules: z.number().int().positive().nullable(),
    }),
  }),
});
