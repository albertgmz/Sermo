import type { Ctx } from "../../context";

/**
 * The members whose profile is not open to everyone, with the mode that closes it (an account
 * awaiting approval counts as `self`), kept for a short while: the figure the members directory
 * places its numbered pages by. Apart from the read so the write that changes a privacy setting
 * imports nothing else.
 */
export type RestrictedProfile = { id: number; mode: "members" | "followed" | "self" };
export const restrictedProfiles = new WeakMap<Ctx, { at: number; rows: RestrictedProfile[] }>();

/** Drops the kept list, so a member who just closed their profile is placed by it at once. */
export function forgetRestrictedProfiles(ctx: Ctx): void {
  restrictedProfiles.delete(ctx);
}
