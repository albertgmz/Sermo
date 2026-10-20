import { AppPrompts } from "@/components/layout/app-prompts";
import { AppIcon } from "@/components/layout/logo";
import { getPushKey } from "@/lib/sermo/push";
import { getViewer } from "@/lib/sermo/session";

// What the cards that offer the app need from the server: who is asking, whether the forum can send
// pushes, and the app's icon (drawn here, so the data saver decides about it). A member who still
// has terms or rules to accept sees the acceptance screen and nothing on top of it; an account that
// waits for approval may not save a device yet, so it is offered the app only.
export async function AppPromptsGate() {
  const [{ user }, pushKey] = await Promise.all([getViewer(), getPushKey()]);
  if (user && user.pendingAcceptance.length > 0) return null;
  return (
    <AppPrompts
      member={
        user && !user.awaitingApproval ? { createdAt: user.createdAt } : null
      }
      pushKey={pushKey}
      icon={<AppIcon />}
    />
  );
}
