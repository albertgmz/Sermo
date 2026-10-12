import "server-only";

import { navigationGet } from "@sermo/core/contracts";
import { cache } from "react";
import { call } from "./client";
import { SermoError } from "./errors";

export type NavigationLink = {
  id: number;
  title: string;
  target: string | null;
  builtin: string | null;
};
export type NavigationEntry = NavigationLink & { children: NavigationLink[] };
export type Navigation = {
  header: NavigationEntry[];
  mobile: NavigationEntry[];
  account: NavigationEntry[];
  footer: NavigationEntry[];
};

const EMPTY: Navigation = { header: [], mobile: [], account: [], footer: [] };

// What the current visitor may see, so it is asked with their cookies once per request. A backend
// that cannot be reached leaves the lists empty and the page still renders. Anything that is not
// an API error (the signal that this read needs the request) is passed on.
export const getNavigation = cache(async (): Promise<Navigation> => {
  try {
    return await call(navigationGet, {});
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
    // `next build` prerenders without a backend, so nothing is logged during the build.
    if (process.env.NEXT_PHASE !== "phase-production-build")
      console.error("The navigation could not be read from the API", error);
    return EMPTY;
  }
});
