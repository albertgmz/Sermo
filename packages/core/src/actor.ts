import { GROUP_IDS } from "./db/schema";
import { UnauthenticatedError } from "./errors";

/**
 * Everything a permission check needs about a member, read in one lookup when the request's
 * actor is resolved (or with a notification recipient's row). Checks never query.
 */
export interface Principal {
  /** The member's permission combination (users.permission_combination_id); 0 if unknown. */
  readonly combinationId: number;
  readonly bannedUntil: number | null;
  readonly bannedPermanently: boolean;
  readonly restrictedPostingUntil: number | null;
  readonly restrictedConversationsUntil: number | null;
  readonly restrictedProfilePostsUntil: number | null;
  readonly createdAt: number;
  readonly postCount: number;
  /**
   * Cache versions read with the principal. The in-memory permission state is refreshed only
   * when it is older than these, so a request sees changes committed before it started.
   */
  readonly versions: PermissionVersions;
}

export interface PermissionVersions {
  readonly permissions: number;
  readonly nodeTree: number;
}

/**
 * Who is making a call. Every service function receives one and enforces permissions itself.
 * A token actor acts with its user's permissions; it cannot manage sessions or tokens.
 * `principal` is filled by actor resolution; when absent (fixtures, internal callers), checks
 * load it from the database.
 */
export type Actor =
  | { readonly kind: "guest"; readonly versions?: PermissionVersions }
  | {
      readonly kind: "user";
      readonly userId: number;
      /** Primary group. Permissions come from the principal's combination, never from this. */
      readonly groupId: number;
      readonly sessionId: number;
      /** Trusted client IP supplied by the HTTP actor resolver when available. */
      readonly clientIp?: string;
      readonly principal?: Principal;
    }
  | {
      readonly kind: "token";
      readonly userId: number;
      readonly groupId: number;
      readonly tokenId: number;
      readonly clientIp?: string;
      readonly principal?: Principal;
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
