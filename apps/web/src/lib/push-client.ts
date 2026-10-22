import {
  type Platform,
  type PushAvailability,
  platformOf,
  pushAvailability,
} from "@/lib/app-prompts";
import {
  removePushSubscription,
  restorePushSubscription,
  savePushSubscription,
} from "@/lib/push-actions";
import {
  keepsSubscription,
  keyBytes,
  PUSH_OWNER_KEY,
  PUSH_SESSION_KEY,
  restoreNeeded,
} from "@/lib/push-device";

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

// Said on the window when this device's pushes were turned on or off here, so the cards that read the
// subscription once (`AppPrompts`) read it again.
const CHANGED = "sermo-push-change";

function changed() {
  window.dispatchEvent(new Event(CHANGED));
}

export function onPushChange(listener: () => void) {
  window.addEventListener(CHANGED, listener);
  return () => window.removeEventListener(CHANGED, listener);
}

function readOwner() {
  try {
    return localStorage.getItem(PUSH_OWNER_KEY);
  } catch {
    return null;
  }
}

function readSession() {
  try {
    return localStorage.getItem(PUSH_SESSION_KEY);
  } catch {
    return null;
  }
}

// The member this browser's pushes are on for and the session the account last knew the device
// under; both are forgotten together.
function writeOwner(member: string | null, session: string | null = null) {
  try {
    if (member) localStorage.setItem(PUSH_OWNER_KEY, member);
    else localStorage.removeItem(PUSH_OWNER_KEY);
    if (member && session) localStorage.setItem(PUSH_SESSION_KEY, session);
    else localStorage.removeItem(PUSH_SESSION_KEY);
  } catch {}
}

// Saves the kept subscription on the account again, under the current session, when the member
// signed in again since the account last had it (`restoreNeeded`); with the same session there is no
// request at all. Run without waiting, so the page does not. A "Turn off" tapped while it ran leaves
// nothing behind: the row it wrote is removed. The session is recorded even when the account was
// full, so the next try waits for the next session instead of asking on every page.
async function restoreIfLost(
  subscription: PushSubscription,
  member: string,
  session: string,
) {
  const { keys } = subscription.toJSON();
  if (!keys?.p256dh || !keys.auth) return;
  const { endpoint } = subscription;
  const done = await restorePushSubscription(
    { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    navigator.userAgent,
    { member, session },
  );
  if (!done.ok) return;
  if ((await currentSubscription())?.endpoint !== endpoint) {
    if (done.result !== "full") await removePushSubscription(endpoint);
    return;
  }
  writeOwner(member, session);
  if (done.result === "saved") changed();
}

// This browser's subscription when it serves the one viewing (`keepsSubscription`). One that does
// not is let go at once: the browser drops it, so the push service refuses the next send and the
// backend forgets the row, and a member's own stale row is removed from their account now. One
// that is kept but that the account lost with the session it was saved under is saved again,
// silently, once for each session the browser has not saved it under: the member's pushes were on
// and the permission is granted. `session` is the viewer's session, null where nothing is to be
// restored (a page that only reads, a member who must accept terms first).
// `member` is the viewer's id, null for a guest; `publicKey` the forum's, null when unknown.
export async function heldSubscription(
  member: string | null,
  publicKey: string | null,
  session: string | null = null,
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
  if (keep) {
    if (
      member &&
      session &&
      publicKey &&
      restoreNeeded({ stored: readSession(), session })
    )
      void restoreIfLost(subscription, member, session).catch(() => {});
    return subscription;
  }
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
  session: string | null,
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
      writeOwner(member, session);
      changed();
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
    changed();
    const removed = await removePushSubscription(endpoint);
    return removed.ok ? { ok: true } : { ok: false, error: removed.error };
  } catch {
    return { ok: false };
  }
}
