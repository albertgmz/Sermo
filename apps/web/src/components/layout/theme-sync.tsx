"use client";

import { useEffect } from "react";
import { setTheme, type Theme } from "@/components/layout/theme";
import { rememberTheme } from "@/components/layout/theme-actions";

// A member whose account holds a theme this browser does not know yet (they changed it on another
// device, or signed in here): the browser takes the account's choice now and has the server keep
// it in the cookie the page script reads, so the next page is drawn right from the start. The
// server draws this only when the cookie differs from the account.
export function ThemeSync({ theme }: { theme: Theme }) {
  useEffect(() => {
    setTheme(theme);
    rememberTheme(theme).catch(() => {});
  }, [theme]);
  return null;
}
