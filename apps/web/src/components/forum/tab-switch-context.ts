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

// The switches on the screen and what each owns of the address.
export type Registered = { params: readonly string[] };

export const switches = new Set<Registered>();
