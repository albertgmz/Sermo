import { GROUP_IDS } from "./db/schema";
import { UnauthenticatedError } from "./errors";

/**
 * Who is making a call. Every service function receives one and enforces permissions itself.
 * A token actor acts with its user's permissions; it cannot manage sessions or tokens.
 */
export type Actor =
  | { readonly kind: "guest" }
  | {
      readonly kind: "user";
      readonly userId: number;
      readonly groupId: number;
      readonly sessionId: number;
    }
  | {
      readonly kind: "token";
      readonly userId: number;
      readonly groupId: number;
      readonly tokenId: number;
    };

export type AuthenticatedActor = Exclude<Actor, { kind: "guest" }>;

export const GUEST: Actor = Object.freeze({ kind: "guest" });

export function actorUserId(actor: Actor): number | null {
  return actor.kind === "guest" ? null : actor.userId;
}

export function actorGroupId(actor: Actor): number {
  return actor.kind === "guest" ? GROUP_IDS.guest : actor.groupId;
}

/** Throws UnauthenticatedError for guests; narrows the actor otherwise. */
export function requireAuthenticated(actor: Actor): AuthenticatedActor {
  if (actor.kind === "guest") throw new UnauthenticatedError();
  return actor;
}
