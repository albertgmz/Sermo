"use client";

import { useEffect } from "react";
import { whenIdle } from "@/lib/when-idle";
import type { OneTapOptions } from "./one-tap-prompt";

// Google One Tap: Google's own prompt to sign in with the Google account the browser is signed in
// to, drawn only for a guest while Google sign-in is on (`OneTapGate`). This island is all the page
// loads with: once the page has loaded and the browser is idle it imports the prompt's code, which
// fetches Google's library (`one-tap-prompt.ts`). Draws nothing itself.
export function OneTap({ clientId, locale, context, next }: OneTapOptions) {
  useEffect(() => {
    let gone = false;
    let stop = () => {};
    const cancel = whenIdle(() => {
      import("./one-tap-prompt")
        .then(({ showOneTap }) => {
          if (!gone) stop = showOneTap({ clientId, locale, context, next });
        })
        .catch(() => {});
    });
    return () => {
      gone = true;
      cancel();
      stop();
    };
  }, [clientId, locale, context, next]);
  return null;
}
