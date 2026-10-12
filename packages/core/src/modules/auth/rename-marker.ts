import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Set around the one Better Auth call that may change a username, made by `users.changeUsername`
 * after it has charged for the change. Better Auth's own update endpoint runs in the request that
 * reached it, outside this scope, so the auth module's update hook refuses any username change it
 * does not find marked. `reserved` lets the change take a name the forum keeps for erased
 * accounts (see `isReservedUsername`): only an erasure, or the undoing of a change, sets it.
 */
export const usernameChange = new AsyncLocalStorage<{ userId: number; reserved: boolean }>();

/** Runs `change` as the member's username change; the update hook accepts only calls made so. */
export function asUsernameChange<T>(
  userId: number,
  change: () => Promise<T>,
  reserved = false,
): Promise<T> {
  return usernameChange.run({ userId, reserved }, change);
}
