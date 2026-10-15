import * as z from "zod";
import { IP_ACTIONS } from "../db/schema";
import { defineContract } from "../operation";
import { Id, Page, pageInput, Timestamp, UserSummary } from "./common";

/** Where a request came from, as coarse as the trusted source gave it; any part may be null. */
export const Location = z
  .object({
    country: z.string().nullable().describe("ISO 3166-1 alpha-2 code, upper case."),
    region: z.string().nullable(),
    city: z.string().nullable(),
  })
  .meta({ id: "Location" });

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
    "caller), when the content is not visible to the caller, or when its author ranks at or " +
    "above the caller (a super admin is bound by neither). A thread's address is its first " +
    "post's. Private messages are not offered. Requires member.viewIps.",
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
    "not counted. Requires member.viewIps over the member: refused for a member of equal or " +
    "higher rank (a super admin is bound by none).",
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
    "Members of equal or higher rank than the caller are left out (a super admin sees all), " +
    "so a page can hold fewer items than `limit` while `nextCursor` is set. A value that is " +
    "not an address is a validation error. Requires member.viewIps.",
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
    "The device, address and approximate place of each of the signed-in member's live sessions, " +
    "by session id, parsed from the user agent the session was opened with, and when each was " +
    "last used (to within a few minutes; null for a session that predates the record). Only a " +
    "browser session may ask.",
  kind: "read",
  input: z.object({}),
  output: z.object({
    items: z.array(
      z.object({
        sessionId: Id,
        ipAddress: z.string().nullable(),
        device: Device,
        location: Location.nullable(),
        lastActiveAt: Timestamp.nullable(),
      }),
    ),
  }),
});

export const SIGN_IN_HISTORY_LIMIT = 100;

export const authSignInHistory = defineContract({
  name: "auth.signInHistory",
  summary:
    "The signed-in member's own recent sign-ins, newest first, successful and failed (a wrong " +
    "password for this account), each with its time, device, approximate place and result. The " +
    "log keeps rows for a limited time (see privacy.logRetention). Only a browser session may ask.",
  kind: "read",
  input: z.object({ limit: z.number().int().min(1).max(SIGN_IN_HISTORY_LIMIT).default(20) }),
  output: z.object({
    items: z.array(
      z.object({
        id: Id,
        at: Timestamp,
        result: z.enum(["success", "failed"]),
        device: Device,
        location: Location.nullable(),
      }),
    ),
  }),
});

export const authNotMe = defineContract({
  name: "auth.notMe",
  summary:
    "The 'This wasn't me' link of a new-sign-in mail, without signing in: signs the member out " +
    "everywhere (every session and API key). The signed token is the authorization; it works " +
    "once, expires after a week, and stops working as soon as the member's sessions have been " +
    "cut since the sign-in it was sent for.",
  kind: "write",
  input: z.object({ token: z.string().min(16).max(1000) }),
  output: z.object({ revoked: z.number().int().nonnegative() }),
});

export const privacyLogRetention = defineContract({
  name: "privacy.logRetention",
  summary:
    "How long the site keeps the log of addresses, devices and places behind sign-ins and " +
    "posts, in days. Public: the privacy and cookie pages state it.",
  kind: "read",
  input: z.object({}),
  output: z.object({ days: z.number().int().positive() }),
});

/** Every action that leaves a row in the address log: the privacy pages list what each kind records. */
export const IP_LOG_ACTIONS = IP_ACTIONS;
