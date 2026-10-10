import { timingSafeEqual } from "node:crypto";
import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import {
  PUSH_SUBSCRIPTIONS_PER_MEMBER,
  pushList,
  pushPublicKey,
  pushSubscribe,
  pushUnsubscribe,
} from "../../contracts/notifications";
import { writeTx } from "../../db/tx";
import { ForbiddenError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { iso } from "../../time";
import { allowedPushEndpoint, normalizePushEndpoint, pushVapid } from "./config";

export { configurePush, validatePushVapid } from "./config";
export { deliverPush, registerPushJobs } from "./delivery";

/** Compares two base64url subscription secrets, with or without padding, in constant time. */
function sameSecret(left: string, right: string): boolean {
  const a = Buffer.from(left.replace(/=+$/, ""), "base64url");
  const b = Buffer.from(right.replace(/=+$/, ""), "base64url");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const pushSubscribeOp = implement(pushSubscribe, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  if (!pushVapid(ctx)) throw new ValidationError("Web Push is disabled.");
  const endpoint = allowedPushEndpoint(ctx, input.endpoint);
  if (!endpoint) throw new ValidationError("The endpoint is not an approved push service.");
  writeTx(ctx, () => {
    const existing = prepared(ctx, "push.subscriptionByEndpoint", () =>
      ctx.sqlite.prepare<{ id: number; user_id: number; auth: string }, [string]>(
        "SELECT id,user_id,auth FROM push_subscriptions WHERE endpoint = ?1",
      ),
    ).get(endpoint);
    if (existing && existing.user_id !== user.userId && !sameSecret(existing.auth, input.keys.auth))
      throw new ForbiddenError();
    const transferring = existing && existing.user_id !== user.userId;
    if (!existing || existing.user_id !== user.userId) {
      const devices = prepared(ctx, "push.oldestDevices", () =>
        ctx.sqlite.prepare<{ id: number }, [number, number]>(
          "SELECT id FROM push_subscriptions WHERE user_id = ?1 ORDER BY id LIMIT ?2",
        ),
      ).all(user.userId, PUSH_SUBSCRIPTIONS_PER_MEMBER);
      if (devices.length === PUSH_SUBSCRIPTIONS_PER_MEMBER)
        prepared(ctx, "push.removeOldest", () =>
          ctx.sqlite.prepare("DELETE FROM push_subscriptions WHERE id = ?1 AND user_id = ?2"),
        ).run(devices[0]!.id, user.userId);
    }
    if (existing && !transferring) {
      prepared(ctx, "push.updateSubscription", () =>
        ctx.sqlite.prepare(
          "UPDATE push_subscriptions SET p256dh = ?1,auth = ?2,user_agent = ?3 WHERE id = ?4 AND user_id = ?5",
        ),
      ).run(input.keys.p256dh, input.keys.auth, input.userAgent, existing.id, user.userId);
    } else {
      if (transferring)
        prepared(ctx, "push.removeTransferred", () =>
          ctx.sqlite.prepare("DELETE FROM push_subscriptions WHERE id = ?1 AND auth = ?2"),
        ).run(existing.id, existing.auth);
      prepared(ctx, "push.insertSubscription", () =>
        ctx.sqlite.prepare(
          "INSERT INTO push_subscriptions (user_id,endpoint,p256dh,auth,user_agent,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
        ),
      ).run(user.userId, endpoint, input.keys.p256dh, input.keys.auth, input.userAgent, ctx.now());
    }
  });
  return { ok: true as const };
});

export const pushListOp = implement(pushList, (ctx, actor) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  const rows = prepared(ctx, "push.list", () =>
    ctx.sqlite.prepare<{ endpoint: string; user_agent: string; created_at: number }, [number]>(
      "SELECT endpoint,user_agent,created_at FROM push_subscriptions WHERE user_id = ?1 ORDER BY id",
    ),
  ).all(user.userId);
  return {
    items: rows.map((row) => ({
      endpoint: row.endpoint,
      userAgent: row.user_agent,
      createdAt: iso(row.created_at),
    })),
  };
});

export const pushUnsubscribeOp = implement(pushUnsubscribe, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  const endpoint = normalizePushEndpoint(input.endpoint);
  if (!endpoint) return { ok: true as const };
  writeTx(ctx, () => {
    prepared(ctx, "push.removeOwnSubscription", () =>
      ctx.sqlite.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1 AND user_id = ?2"),
    ).run(endpoint, user.userId);
  });
  return { ok: true as const };
});

export const pushPublicKeyOp = implement(
  pushPublicKey,
  (ctx) => ({ publicKey: pushVapid(ctx)?.publicKey ?? null }),
  { public: "The application server key is public by design." },
);

export const operations = [pushSubscribeOp, pushUnsubscribeOp, pushListOp, pushPublicKeyOp];
