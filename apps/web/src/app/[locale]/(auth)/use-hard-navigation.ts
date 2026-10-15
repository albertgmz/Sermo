"use client";

import { useEffect } from "react";

// Goes to `address` with a full page load once an action asks for it. A sign-in that adopted the
// member's saved cookie choice needs it: the cookie banner running in the page started without that
// choice and reads its cookie only when it starts.
export function useHardNavigation(address: string | undefined) {
  useEffect(() => {
    if (address) window.location.assign(address);
  }, [address]);
}
