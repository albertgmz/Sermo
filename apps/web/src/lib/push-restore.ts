import {
  removePushSubscription,
  restorePushSubscription,
} from "@/lib/push-actions";
import { changed, currentSubscription, writeOwner } from "@/lib/push-client";

// Saves the kept subscription on the account again, under the current session, when the member
// signed in again since the account last had it (`restoreNeeded`); with the same session there is no
// request at all. Run without waiting, so the page does not. A "Turn off" tapped while it ran leaves
// nothing behind: the row it wrote is removed. The session is recorded even when the account was
// full, so the next try waits for the next session instead of asking on every page.
export async function restoreIfLost(
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
