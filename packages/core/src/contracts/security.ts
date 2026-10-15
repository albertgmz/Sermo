import * as z from "zod";
import { IP_ACTIONS } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Page, pageInput, Timestamp, UserSummary } from "./common";

/** What was parsed from a request's user agent; the raw string is not kept in the log. */
export const Device = z
  .object({
    browser: z.string().nullable(),
    os: z.string().nullable(),
    deviceType: z.string().nullable().describe("smartphone, tablet, desktop, ..."),
    brand: z.string().nullable(),
    model: z.string().nullable(),
    isBot: z.boolean(),
  })
  .meta({ id: "Device" });

const IpAction = z.enum(IP_ACTIONS);

/** One address a content item or a member was seen at, as the log recorded it. */
const IpEntry = z.object({
  userId: Id,
  ip: z.string().describe("Normalised: IPv4-mapped IPv6 addresses appear as IPv4."),
  action: IpAction,
  createdAt: Timestamp,
  device: Device,
});

export const ipsContent = defineContract({
  name: "ips.content",
  summary:
    "The address a piece of content was made from, with the device and the member: `entry` is " +
    "null when the log holds none (content from before the log, or made by an internal " +
    "caller). A thread's address is its first post's. Private messages are not offered. " +
    "Requires member.viewIps.",
  kind: "read",
  // Private messages are read only through the audited report view, so they are not here.
  input: z.object({
    contentType: z.enum(["post", "profile_post", "profile_post_comment"]),
    contentId: Id,
  }),
  output: z.object({ entry: IpEntry.nullable() }),
});

export const usersIps = defineContract({
  name: "users.ips",
  summary:
    "Every address a member has used (signed in, registered, posted, reported), most recently " +
    "used first, with how many times and when it was first and last seen. Failed sign-ins are " +
    "not counted. Requires member.viewIps.",
  kind: "read",
  input: z.object({ userId: Id, ...pageInput }),
  output: Page(
    z.object({
      ip: z.string(),
      network: z.string().describe("The address itself for IPv4; the /64 for IPv6."),
      count: z.number().int().positive(),
      firstSeenAt: Timestamp,
      lastSeenAt: Timestamp,
    }),
  ),
});

export const ipsMembers = defineContract({
  name: "ips.members",
  summary:
    "The members who used an address, most recently active first, with how many times and when " +
    "each was first and last seen there. An IPv6 address is matched by its /64 network (the " +
    "network is returned, and a `/64` written out is accepted); an IPv4 address matches itself. " +
    "A value that is not an address is a validation error. Requires member.viewIps.",
  kind: "read",
  input: z.object({ ip: z.string().trim().min(1).max(64), ...pageInput }),
  output: z.object({
    network: z.string(),
    items: z.array(
      z.object({
        user: UserSummary,
        count: z.number().int().positive(),
        firstSeenAt: Timestamp,
        lastSeenAt: Timestamp,
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
});

export const authSessionDevices = defineContract({
  name: "auth.sessionDevices",
  summary:
    "The device and address of each of the signed-in member's live sessions, by session id, " +
    "parsed from the user agent the session was opened with. Only a browser session may ask.",
  kind: "read",
  input: z.object({}),
  output: z.object({
    items: z.array(z.object({ sessionId: Id, ipAddress: z.string().nullable(), device: Device })),
  }),
});
