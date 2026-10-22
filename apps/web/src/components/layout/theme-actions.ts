"use server";

import { preferencesUpdate } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import {
  ACCOUNT_THEME_COOKIE,
  ACCOUNT_THEME_COOKIE_OPTIONS,
  isTheme,
  type Theme,
} from "@/components/layout/theme";
import { call } from "@/lib/sermo/client";
import { secureCookies } from "@/lib/sermo/config";
import { SermoError } from "@/lib/sermo/errors";
import { attemptInPlace, invalidArgument } from "@/lib/sermo/outcome";
import { getViewer } from "@/lib/sermo/session";

async function writeThemeCookie(theme: Theme) {
  (await cookies()).set(ACCOUNT_THEME_COOKIE, theme, {
    ...ACCOUNT_THEME_COOKIE_OPTIONS,
    secure: secureCookies(),
  });
}

// Keeps the visitor's colour theme on their account when they are signed in (and may edit their
// profile), and the cookie the page script reads in step with it. A guest, or a member whose
// choice cannot be saved, keeps the browser's own choice: a cookie left from an earlier session is
// dropped so it does not override it. The answer carries the backend's message when it refuses,
// and where to sign in when the session has ended.
export async function saveTheme(
  theme: string,
): Promise<{ ok: true } | { ok: false; error: string; signIn?: string }> {
  if (!isTheme(theme)) return { ok: false, error: await invalidArgument() };
  const { user, resolvedPermissions } = await getViewer();
  if (user && resolvedPermissions["profile.editOwn"] !== false) {
    const saved = await attemptInPlace("/", async () => {
      try {
        await call(preferencesUpdate, { theme });
        return "account" as const;
      } catch (error) {
        if (error instanceof SermoError && error.code === "forbidden")
          return "browser" as const;
        throw error;
      }
    });
    if (!saved.ok)
      return {
        ok: false,
        error: saved.error,
        ...(saved.signIn ? { signIn: saved.signIn } : {}),
      };
    if (saved.value === "account") {
      await writeThemeCookie(theme);
      return { ok: true };
    }
  }
  (await cookies()).delete(ACCOUNT_THEME_COOKIE);
  return { ok: true };
}

// Writes the cookie for `ThemeSync`: the browser has taken the theme its member's account holds,
// and the next page should be drawn in it from the start.
export async function rememberTheme(theme: string) {
  if (isTheme(theme)) await writeThemeCookie(theme);
}

// Drops the cookie for `ThemeSync` when it holds a theme no account in this browser claims.
export async function forgetTheme() {
  (await cookies()).delete(ACCOUNT_THEME_COOKIE);
}
