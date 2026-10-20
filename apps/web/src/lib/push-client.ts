import {
  type Platform,
  type PushAvailability,
  platformOf,
  pushAvailability,
} from "@/lib/app-prompts";
import {
  removePushSubscription,
  savePushSubscription,
} from "@/lib/push-actions";
import { keepsSubscription, keyBytes, PUSH_OWNER_KEY } from "@/lib/push-device";

// The browser's side of pushes: what this device can do, its subscription, and turning it on and
// off. The account's copy is kept through the server actions of `push-actions.ts`.

export function currentPlatform(): Platform {
  return platformOf({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as { standalone?: boolean }).standalone === true,
  });
}

export function currentAvailability(platform: Platform): PushAvailability {
  return pushAvailability({
    apis:
      window.isSecureContext &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
    // Only a production build registers the worker that receives pushes (`worker-registration`).
    worker:
      process.env.NODE_ENV === "production" &&
      process.env.SERMO_RETIRE_WORKER !== "1",
    platform,
  });
}

export function currentPermission(): NotificationPermission | null {
  return "Notification" in window ? Notification.permission : null;
}

// The worker's registration once it runs. Registration waits for the page to be idle, so this can
// take a moment on the first page; it gives up after `ms`.
async function registration(ms = 10_000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function currentSubscription() {
  const ready = await registration();
  return ready ? ready.pushManager.getSubscription() : null;
}

function sameKey(held: ArrayBuffer | null, wanted: Uint8Array) {
  if (!held) return false;
  const bytes = new Uint8Array(held);
  return (
    bytes.length === wanted.length &&
    bytes.every((byte, at) => byte === wanted[at])
  );
}

function readOwner() {
  try {
    return localStorage.getItem(PUSH_OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(member: string | null) {
  try {
    if (member) localStorage.setItem(PUSH_OWNER_KEY, member);
    else localStorage.removeItem(PUSH_OWNER_KEY);
  } catch {}
}

// This browser's subscription when it serves the one viewing (`keepsSubscription`). One that does
// not is let go at once: the browser drops it, so the push service refuses the next send and the
// backend forgets the row, and a member's own stale row is removed from their account now.
// `member` is the viewer's id, null for a guest; `publicKey` the forum's, null when unknown.
export async function heldSubscription(
  member: string | null,
  publicKey: string | null,
) {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const keep = keepsSubscription({
    owner: readOwner(),
    member,
    keyMatches: publicKey
      ? sameKey(subscription.options.applicationServerKey, keyBytes(publicKey))
      : null,
  });
  if (keep) return subscription;
  const { endpoint } = subscription;
  await subscription.unsubscribe().catch(() => false);
  writeOwner(null);
  if (member) await removePushSubscription(endpoint).catch(() => {});
  return null;
}

export type TurnOn =
  | { ok: true }
  | { ok: false; reason: "denied" | "dismissed" | "failed"; error?: string };

// Asks the browser (it must be the first thing a tap does: iOS and Firefox take the question only
// from a tap), subscribes this device and saves it on the account. A subscription made for other
// keys (the forum changed them) is replaced, on the account too. When the account refuses it, the browser's
// subscription is taken back, so the device is not left subscribed for nothing. The member it was
// turned on for is recorded (`heldSubscription`).
export async function turnOnPush(
  publicKey: string,
  member: string,
): Promise<TurnOn> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    return {
      ok: false,
      reason: permission === "denied" ? "denied" : "dismissed",
    };
  try {
    const ready = await registration();
    if (!ready) return { ok: false, reason: "failed" };
    const key = keyBytes(publicKey);
    let subscription = await ready.pushManager.getSubscription();
    if (
      subscription &&
      !sameKey(subscription.options.applicationServerKey, key)
    ) {
      const { endpoint } = subscription;
      await subscription.unsubscribe();
      await removePushSubscription(endpoint).catch(() => {});
      subscription = null;
    }
    subscription ??= await ready.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    const json = subscription.toJSON();
    const saved = await savePushSubscription(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      },
      navigator.userAgent,
    );
    if (saved.ok) {
      writeOwner(member);
      return { ok: true };
    }
    await subscription.unsubscribe().catch(() => {});
    return { ok: false, reason: "failed", error: saved.error };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

// Stops pushes to this device: the browser drops its subscription and the account forgets it.
export async function turnOffPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const subscription = await currentSubscription();
    if (!subscription) return { ok: true };
    const { endpoint } = subscription;
    await subscription.unsubscribe();
    writeOwner(null);
    const removed = await removePushSubscription(endpoint);
    return removed.ok ? { ok: true } : { ok: false, error: removed.error };
  } catch {
    return { ok: false };
  }
}
