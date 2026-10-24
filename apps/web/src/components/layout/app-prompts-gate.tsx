import { LazyAppPrompts } from "@/components/layout/app-prompts-lazy";
import { AppIcon } from "@/components/layout/logo";
import { getPushKey } from "@/lib/sermo/push";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

// What the cards that offer the app need from the server: who is asking, whether the forum can send
// pushes, the site's name and the app's icon (drawn here, so the data saver decides about it). A
// member who still has terms or rules to accept sees the acceptance screen and no card on top of it;
// an account that waits for approval may not save a device yet, so it is offered the app only. Both
// still have this browser's subscription checked against them (`heldSubscription`).
export async function AppPromptsGate() {
  const [{ user }, pushKey, site] = await Promise.all([
    getViewer(),
    getPushKey(),
    getSite(),
  ]);
  return (
    <LazyAppPrompts
      member={
        user && !user.awaitingApproval
          ? {
              id: String(user.id),
              createdAt: user.createdAt,
              session: user.sessionId === null ? null : String(user.sessionId),
            }
          : null
      }
      offers={!user || user.pendingAcceptance.length === 0}
      pushKey={pushKey}
      appName={site.name}
      icon={<AppIcon />}
    />
  );
}
