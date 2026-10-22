import { cookies } from "next/headers";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import { ThemeSync } from "@/components/layout/theme-sync";
import { getViewer } from "@/lib/sermo/session";

// Draws `ThemeSync` when the browser's theme cookie differs from the account: a member whose
// account holds a theme the cookie does not, or a cookie with no account theme behind it (a guest,
// or a member who chose none) that an earlier session left. The viewer is the request's one
// `auth.me` read, shared with the rest of the page.
export async function ThemeSyncGate() {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const theme = viewer.user?.theme ?? null;
  const kept = store.get(ACCOUNT_THEME_COOKIE)?.value;
  if (kept === (theme ?? undefined)) return null;
  return <ThemeSync theme={theme} />;
}
