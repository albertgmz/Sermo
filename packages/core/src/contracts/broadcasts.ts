import * as z from "zod";
import { defineContract } from "../operation";
import { ActorPassword, Body, Empty, Id, Timestamp, Title, UserSummary } from "./common";
import { CriteriaRule } from "./criteria";
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

export const BroadcastRun = z
  .object({
    /** Idle: nothing was run yet. Failed or stopped: starting the same kind of run again resumes it. */
    state: z.enum(["idle", "running", "failed", "stopped", "done"]),
    kind: z.enum(["message", "alert"]).nullable(),
    /** True: a count. Nothing was sent. */
    dryRun: z.boolean(),
    /** The message's title or the alert's text. */
    summary: z.string(),
    startedAt: Timestamp.nullable(),
    finishedAt: Timestamp.nullable(),
    /** How far through the members the run is, from 0 to 1. */
    progress: z.number().min(0).max(1),
    /** Members looked at so far. */
    members: z.number().int().nonnegative(),
    /** Members who are in the audience and may be written to (not banned, erased or unconfirmed). */
    matched: z.number().int().nonnegative(),
    /** Messages or alerts sent (0 for a count). */
    sent: z.number().int().nonnegative(),
    /** Matched members who cannot be reached: they may not receive conversations, or turned this alert off. */
    skipped: z.number().int().nonnegative(),
    error: z.string().nullable(),
  })
  .meta({ id: "BroadcastRun" });

export const broadcastsStart = defineContract({
  name: "broadcasts.start",
  summary:
    "Start a background run that sends a private message (one conversation per member, never one " +
    "conversation with many participants) or an alert to every member the rule names, in small " +
    "chunks. `rule` is the audience: the criteria engine's rule (an empty rule is every member), " +
    "any criterion. Members who are banned, erased, unconfirmed or awaiting approval are never " +
    "written to. A message ignores the members' ignore lists, as staff messages do, but a member " +
    "without `conversation.receive` is skipped; each member is alerted that they were added to " +
    "the conversation, as their preferences say. An alert (notification type `admin.alert`) " +
    "follows each member's preferences for that type: in the alert list, pushed to their devices " +
    "by default and e-mailed only if they opted in. With dryRun true nothing is sent and the run " +
    "only counts the members it would reach. A run that stopped (on an error, or by " +
    "broadcasts.stop) resumes from where it stopped, with the content and audience it started " +
    "with, when called again with the same dryRun: leave `content` and `rule` out to resume " +
    "(giving them to a stopped run does not change it). Returns queued false when a run is under way. Sending as " +
    "another member needs admin.members over that member. Requires admin.announcements. A real " +
    "send needs `actorPassword`, the acting administrator's own password: a browser session must " +
    "send it, and an API key cannot start it; a count needs none.",
  kind: "write",
  input: z.object({
    /** Left out together with `rule` to resume the run that stopped. */
    content: BroadcastContent.optional(),
    rule: CriteriaRule.optional(),
    dryRun: z.boolean().default(false),
    actorPassword: ActorPassword.optional(),
  }),
  output: z.object({ queued: z.boolean() }),
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
    "The latest run of broadcasts.start, real or count: where it stands and how many members it " +
    "reached or would reach so far. Requires admin.announcements.",
  kind: "read",
  input: Empty,
  output: BroadcastRun,
});

export const broadcastsStop = defineContract({
  name: "broadcasts.stop",
  summary:
    "Ask the run under way to end before its next chunk, leaving what is sent as it is. Calling " +
    "broadcasts.start again resumes it. Returns stopped false when none is under way. Requires " +
    "admin.announcements.",
  kind: "write",
  input: Empty,
  output: z.object({ stopped: z.boolean() }),
});
