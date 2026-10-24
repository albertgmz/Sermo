"use client";

import { createContext, useContext } from "react";

// What a `TabSwitch` tells the controls inside it: kept apart from the switch, so a tab bar that is
// in none (most are) does not bring the switch's code to the page.
export type Switching = {
  // The place being asked for, until it is on screen.
  pending: string | null;
  placeOf: (search: string) => string;
  // Shows the part an address on this page names; false when the switch shows it already.
  go: (href: string) => boolean;
  // Draws the part on screen again, in place: what it shows has changed.
  reload: () => void;
};

export const SwitchContext = createContext<Switching | null>(null);

// The switch around a component, for a control that changes the address itself (a filter sheet).
export function useTabSwitch() {
  return useContext(SwitchContext);
}

// The switches on the screen: what each owns of the address, whether an address changes what it
// shows, and its `go`.
export type Registered = {
  params: readonly string[];
  differs: (search: string) => boolean;
  go: (href: string) => boolean;
};

export const switches = new Set<Registered>();

// For a link to this page outside every switch (a menu in the page's header): the one switch its
// address changes shows it in place. True when one did; the link then opens nothing.
export function goInPlace(href: string) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin || url.pathname !== location.pathname)
    return false;
  const changed = [...switches].filter((entry) => entry.differs(url.search));
  return changed.length === 1 && changed[0].go(url.href);
}
