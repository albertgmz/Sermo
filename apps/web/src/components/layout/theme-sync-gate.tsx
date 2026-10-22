import { cookies } from "next/headers";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import { ThemeSync } from "@/components/layout/theme-sync";
import { getViewer } from "@/lib/sermo/session";

// Draws `ThemeSync` for a member whose account holds a theme and whose browser's cookie says
// something else. The viewer is the request's one `auth.me` read, shared with the rest of the page.
export async function ThemeSyncGate() {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const theme = viewer.user?.theme;
  if (!theme || store.get(ACCOUNT_THEME_COOKIE)?.value === theme) return null;
  return <ThemeSync theme={theme} />;
}
