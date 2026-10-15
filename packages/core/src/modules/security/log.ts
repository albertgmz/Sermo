import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import type { IpAction, IpContentType } from "../../db/schema";
import { markPublic } from "../../operation";
import { parseAddress } from "./address";
import { type Device, deviceOf } from "./device";

export interface IpContent {
  readonly type: IpContentType;
  readonly id: number;
}

export const ipLogSql = {
  insert:
    "INSERT INTO ip_log (user_id, ip, ip_net, action, content_type, content_id, browser, os, device_type, brand, model, is_bot, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
  erase: "DELETE FROM ip_log WHERE user_id = ?1",
};

/**
 * Writes one `ip_log` row for a member: the address normalised, the device parsed from the user
 * agent (through the bounded cache). Does nothing when `ip` is not an address (an internal
 * caller, the adapter's `unknown` placeholder). Call it inside the write transaction of the
 * action it records.
 */
export function logMemberIp(
  ctx: Ctx,
  userId: number,
  ip: string | null | undefined,
  userAgent: string | null | undefined,
  action: IpAction,
  content?: IpContent,
): void {
  const address = parseAddress(ip);
  if (!address) return;
  const device: Device = deviceOf(userAgent);
  prepared(ctx, "security.ipLogInsert", () => ctx.sqlite.prepare(ipLogSql.insert)).run(
    userId,
    address.ip,
    address.net,
    action,
    content?.type ?? null,
    content?.id ?? null,
    device.browser,
    device.os,
    device.deviceType,
    device.brand,
    device.model,
    device.isBot ? 1 : 0,
    ctx.now(),
  );
}

/** The same for the signed-in actor of a request: the address and user agent it carries. */
export const logIp = markPublic(
  "Records the actor's own action; it grants and refuses nothing.",
  (ctx: Ctx, actor: Actor, action: IpAction, content?: IpContent): void => {
    if (actor.kind === "guest") return;
    logMemberIp(ctx, actor.userId, actor.clientIp, actor.userAgent, action, content);
  },
);
