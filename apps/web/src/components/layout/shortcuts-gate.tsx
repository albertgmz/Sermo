import { LazyShortcuts } from "@/components/layout/shortcuts-lazy";
import { getViewer } from "@/lib/sermo/session";

// The shortcuts for the page: a member's preference decides, a guest has them on. The viewer is the
// request's one `auth.me` read, shared with the rest of the page.
export async function ShortcutsGate() {
  const { user } = await getViewer();
  return <LazyShortcuts enabled={user ? user.keyboardShortcuts : true} />;
}
