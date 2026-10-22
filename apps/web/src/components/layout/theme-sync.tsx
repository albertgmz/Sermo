"use client";

import { useEffect } from "react";
import { setTheme, type Theme } from "@/components/layout/theme";
import { forgetTheme, rememberTheme } from "@/components/layout/theme-actions";

// The browser's theme cookie and the account disagree. A member whose account holds a theme this
// browser does not know yet (they changed it on another device, or signed in here): the browser
// takes the account's choice now and has the server keep it in the cookie the page script reads,
// so the next page is drawn right from the start. A visitor with no account theme (a guest, or a
// member who chose none) while the cookie holds one left by an earlier session: the server drops
// it, and the page script is told to read this browser's own choice again. The server draws this
// only when the cookie differs from the account.
export function ThemeSync({ theme }: { theme: Theme | null }) {
  useEffect(() => {
    if (theme) {
      setTheme(theme);
      rememberTheme(theme).catch(() => {});
      return;
    }
    forgetTheme()
      .then(() => window.dispatchEvent(new StorageEvent("storage")))
      .catch(() => {});
  }, [theme]);
  return null;
}
