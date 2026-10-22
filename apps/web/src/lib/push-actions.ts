"use server";

import {
  PUSH_SUBSCRIPTIONS_PER_MEMBER,
  pushList,
  pushSubscribe,
  pushUnsubscribe,
} from "@sermo/core/contracts";
import { sameEndpoint } from "@/lib/push-device";
import { call } from "@/lib/sermo/client";
import { attemptInPlace } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

// What the browser hands over for this device (`PushSubscription.toJSON()`): the push service's
// address and the keys the backend encrypts with. The backend checks every field.
export type DeviceSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const SETTINGS = "/account/notifications";

// Saves this device's subscription on the member's account. The browser has already subscribed;
// a refusal comes back as the backend's message and the caller takes the subscription back.
export async function savePushSubscription(
  subscription: DeviceSubscription,
  userAgent: string,
) {
  const saved = await attemptInPlace(SETTINGS, () =>
    call(pushSubscribe, {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      userAgent: String(userAgent).slice(0, 500),
    }),
  );
  return saved.ok ? { ok: true as const } : saved;
}

// Removes a device from the member's account: this one when they turn it off, or another they no
// longer use.
export async function removePushSubscription(endpoint: string) {
  const removed = await attemptInPlace(SETTINGS, () =>
    call(pushUnsubscribe, { endpoint }),
  );
  return removed.ok ? { ok: true as const } : removed;
}

// Saves this device's subscription again when the account no longer lists it. A session that ends
// takes its devices with it (a password change, the session expiring, being signed out from
// another device), while the browser keeps the subscription and the member's pushes are on: the
// browser asks once for each session it has not saved the device under (`restoreNeeded`). It acts
// only for the member and session that page was drawn for, so a sign-in in another tab cannot
// move the device to another account. One the account lists is saved too, which moves it to this
// session (it may still be tied to an older session that is alive, or to none if it predates the
// link) and adds no device. One it does not list is not saved when the member is at the device
// limit: a restore never takes another device's place.
export async function restorePushSubscription(
  subscription: DeviceSubscription,
  userAgent: string,
  viewer: { member: string; session: string },
) {
  const { user } = await getViewer();
  if (
    !user ||
    String(user.id) !== viewer.member ||
    String(user.sessionId) !== viewer.session
  )
    return { ok: false as const, error: "" };
  const restored = await attemptInPlace(SETTINGS, async () => {
    const { items } = await call(pushList, {});
    const listed = items.some((item) =>
      sameEndpoint(item.endpoint, subscription.endpoint),
    );
    if (!listed && items.length >= PUSH_SUBSCRIPTIONS_PER_MEMBER)
      return "full" as const;
    await call(pushSubscribe, {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      userAgent: String(userAgent).slice(0, 500),
    });
    return listed ? ("listed" as const) : ("saved" as const);
  });
  return restored.ok
    ? { ok: true as const, result: restored.value }
    : { ok: false as const, error: restored.error };
}
