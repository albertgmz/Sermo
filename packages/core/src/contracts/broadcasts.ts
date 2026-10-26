import * as z from "zod";
import { defineContract } from "../operation";
import { ActorPassword, Body, Empty, Id, Timestamp, Title, UserSummary } from "./common";
import { NonEmptyCriteriaRule } from "./criteria";
import { AlertUrl } from "./notifications";

/*
 * Staff writing to many members at once: a private message (one conversation per member) or an
 * alert, sent by a background run to the members a criteria rule names. A test sends the same
 * thing to one member at once; a count (a dry run) only says how many a send would reach.
 */

/** The longest alert text. */
export const ALERT_TEXT_MAX = 300;

export const BroadcastContent = z
  .discriminatedUnion("kind", [
    z.object({
      kind: z.literal("message"),
      /** Who the conversations come from; the acting administrator when left out. */
      senderId: Id.optional(),
      title: Title,
      body: Body,
      /** True: members cannot reply. */
      locked: z.boolean().default(false),
      /** True: the sender is not left in each conversation's list (and gets no replies). */
      removeFromSender: z.boolean().default(false),
    }),
    z.object({
      kind: z.literal("alert"),
      text: z.string().trim().min(1).max(ALERT_TEXT_MAX),
      /** What the alert opens: a site path or an http(s) address; the alert list without one. */
      url: AlertUrl.nullable().default(null),
    }),
  ])
  .meta({ id: "BroadcastContent" });

export const BroadcastKind = z.enum(["message", "alert"]);

export const BroadcastRun = z
  .object({
    /** Idle: nothing was run yet. Failed or stopped: broadcasts.resume continues it, broadcasts.discard gives it up. */
    state: z.enum(["idle", "running", "failed", "stopped", "done", "discarded"]),
    kind: BroadcastKind.nullable(),
    /** True: a count. Nothing was sent. */
    dryRun: z.boolean(),
    /** The message's title or the alert's text. */
    summary: z.string(),
    startedAt: Timestamp.nullable(),
    /** The administrator who started or last resumed it, and who the messages come from. */
    startedBy: UserSummary.nullable(),
    sender: UserSummary.nullable(),
    finishedAt: Timestamp.nullable(),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    /** Members looked at so far. */
    members: z.number().int().nonnegative(),
    /** Members who are in the audience and may be written to (not banned, erased or unconfirmed). */
    matched: z.number().int().nonnegative(),
    /** Members a send would reach, from the counts so far: matched less skipped. */
    reachable: z.number().int().nonnegative(),
    /** Messages or alerts sent (0 for a count). */
    sent: z.number().int().nonnegative(),
    /** Matched members who cannot be reached: they may not receive conversations, or turned this alert off. */
    skipped: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })
  .meta({ id: "BroadcastRun" });

/** An action names the run the administrator looked at, so it never falls on another that took its place. */
const SEEN =
  "`runAt` and `kind` name the run as broadcasts.status showed it: a conflict when the stopped " +
  "or failed run is another one (another administrator may have discarded it and started their own).";

const COUNT_FIRST =
  "Every send comes from a count: count the recipients of the message or alert, then send what was counted.";

export const broadcastsCount = defineContract({
  name: "broadcasts.count",
  summary:
    "Start a background count of the members a message or alert would reach: `audience` is " +
    '"everyone" or a rule of the criteria engine with at least one condition (an empty rule is ' +
    "refused, so a rule builder left empty cannot reach every member), any criterion. Members " +
    "who are banned, erased, unconfirmed or awaiting approval are never written to. The count runs " +
    "the delivery chunk by chunk and undoes it, so nothing is sent, queued or alerted, and " +
    "broadcasts.status reports how many would be reached and how many skipped (a member without " +
    "`conversation.receive`, or who turned the alert off). Returns queued false when a run is " +
    "under way, and a conflict while a run is stopped or failed: resume it (broadcasts.resume) or " +
    "discard it (broadcasts.discard) first. Sending as another member needs admin.members over " +
    "that member. Requires admin.announcements; no password. " +
    COUNT_FIRST,
  kind: "write",
  input: z.object({
    content: BroadcastContent,
    audience: z.union([z.literal("everyone"), NonEmptyCriteriaRule]),
  }),
  output: z.object({ queued: z.boolean() }),
});

export const broadcastsSend = defineContract({
  name: "broadcasts.send",
  summary:
    "Send the content and audience of the latest run, which must be a finished count whose " +
    "`startedAt` (from broadcasts.status) is `countedAt`: a conflict otherwise, so what is sent " +
    "is the count the administrator looked at and not a newer one. A private message (one conversation per " +
    "member, never one conversation with many participants; the members' block lists are not " +
    "read, and each member is alerted that they were added) or an alert (notification type " +
    "`admin.alert`; in the alert list, pushed by default, e-mailed only if the member opted in). " +
    "It runs in small chunks in the background; broadcasts.stop ends it and broadcasts.resume " +
    "continues it. Returns queued false when a run is under way, and a validation error when the " +
    "latest run is not a finished count. Requires admin.announcements and, for a message sent as " +
    "another member, admin.members over them. Needs `actorPassword`, the acting administrator's " +
    "own password: a browser session must send it, and an API key or token cannot send.",
  kind: "write",
  input: z.object({ countedAt: Timestamp, actorPassword: ActorPassword.optional() }),
  output: z.object({ queued: z.boolean() }),
});

export const broadcastsResume = defineContract({
  name: "broadcasts.resume",
  summary:
    "Continue the run that stopped (by broadcasts.stop or an error) from the member it stopped at, " +
    "with its own content and audience. " +
    SEEN +
    " A send needs `actorPassword` as broadcasts.send does; a count needs none. Returns queued " +
    "false when a run is under way, and a validation error when the run named is no longer " +
    "stopped or failed. Requires admin.announcements.",
  kind: "write",
  input: z.object({
    runAt: Timestamp,
    kind: BroadcastKind,
    actorPassword: ActorPassword.optional(),
  }),
  output: z.object({ queued: z.boolean() }),
});

export const broadcastsDiscard = defineContract({
  name: "broadcasts.discard",
  summary:
    "Give up the run that stopped or failed, so another can start: what a send already sent stays " +
    "sent. " +
    SEEN +
    " Needs `actorPassword` for a send, none for a count. Logged. Returns discarded false when " +
    "none is stopped or failed. Requires admin.announcements.",
  kind: "write",
  input: z.object({
    runAt: Timestamp,
    kind: BroadcastKind,
    actorPassword: ActorPassword.optional(),
  }),
  output: z.object({ discarded: z.boolean() }),
});

export const broadcastsTest = defineContract({
  name: "broadcasts.test",
  summary:
    "Send the message or alert to one member at once, as a run would: the acting administrator by " +
    "default, or the member `recipientId`. No password and no audience. `delivered` is false, " +
    "with `reason`, when the member cannot receive it (an erased account, no `conversation.receive`, " +
    "the alert turned off). `conversationId` is the conversation of a message. Logged. Requires " +
    "admin.announcements.",
  kind: "write",
  input: z.object({ content: BroadcastContent, recipientId: Id.optional() }),
  output: z.object({
    recipient: UserSummary,
    delivered: z.boolean(),
    reason: z.string().nullable(),
    conversationId: Id.nullable(),
  }),
});

export const broadcastsStatus = defineContract({
  name: "broadcasts.status",
  summary:
    "The latest run, real or count: where it stands and how many members it " +
    "reached or would reach so far. Requires admin.announcements.",
  kind: "read",
  input: Empty,
  output: BroadcastRun,
});

export const broadcastsStop = defineContract({
  name: "broadcasts.stop",
  summary:
    "Ask the run under way to end before its next chunk, leaving what is sent as it is. Calling " +
    "broadcasts.resume continues it. `runAt` names the run as broadcasts.status showed it: a " +
    "conflict when the run under way is another one. Returns stopped false when none is under " +
    "way. Requires admin.announcements.",
  kind: "write",
  input: z.object({ runAt: Timestamp }),
  output: z.object({ stopped: z.boolean() }),
});
