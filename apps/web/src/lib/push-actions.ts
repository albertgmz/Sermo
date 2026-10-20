"use server";

import { pushSubscribe, pushUnsubscribe } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { attemptInPlace } from "@/lib/sermo/outcome";

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
