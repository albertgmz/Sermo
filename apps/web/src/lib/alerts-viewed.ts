import { clearAlertsBadge } from "@/lib/counters";

// The member opened their alerts (the header menu or the alerts page): the server marks them viewed
// and the badge empties where it is drawn. The page is not drawn again; the alerts stay unread, so
// their rows are as they were. `mark` says whether the server took it.
export async function viewAlerts(mark: () => Promise<boolean>) {
  if (await mark()) clearAlertsBadge();
}
