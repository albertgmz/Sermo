import { useSyncExternalStore } from "react";

// Whether an invitation to create an account drawn in the page (`SignupInvite`) is on the screen,
// so the floating card steps aside while one is: a guest sees one invitation at a time.

let inView = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

// One invitation came on the screen; the returned function says it left (once).
export function inviteOnScreen() {
  inView += 1;
  emit();
  let left = false;
  return () => {
    if (left) return;
    left = true;
    inView -= 1;
    emit();
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const anyInviteOnScreen = () => inView > 0;

export function useInviteOnScreen() {
  return useSyncExternalStore(subscribe, anyInviteOnScreen, () => false);
}
