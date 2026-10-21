import { APIError } from "better-auth";
import * as z from "zod";
import type { Ctx } from "../../context";
import { BirthdayInput, Handle, profilesUpdate } from "../../contracts/profiles";
import { REGISTRATION_FIELDS, type RegistrationField } from "../../contracts/settings";
import { ValidationError } from "../../errors";
import { profileFieldChanges } from "../profiles/fields";
import { readSiteSettings } from "../settings";

type Settings = Pick<ReturnType<typeof readSiteSettings>, "minimumAge" | "registrationFields">;

/**
 * The profile fields the sign-up asks, in the order of `REGISTRATION_FIELDS`: the ones the site
 * requires, and the birthday whenever a minimum age is set (the age is read from it).
 */
export function signupFields(settings: Settings): RegistrationField[] {
  const asked = new Set(settings.registrationFields);
  if (settings.minimumAge > 0) asked.add("birthday");
  return REGISTRATION_FIELDS.filter((field) => asked.has(field));
}

const shape = profilesUpdate.input.shape;
/** The `profile` object a sign-up request may carry: the member's own profile fields, flat. */
const SignupProfile = z.object({
  about: shape.about,
  location: shape.location,
  website: shape.website,
  birthday: BirthdayInput.optional(),
  discord: Handle.optional(),
  telegram: Handle.optional(),
  x: Handle.optional(),
});
type SignupProfile = z.infer<typeof SignupProfile>;

const refuse = (status: "BAD_REQUEST" | "FORBIDDEN", code: string, message: string) =>
  new APIError(status, { code, message });

function present(profile: SignupProfile, field: RegistrationField): boolean {
  const value = profile[field];
  if (field === "birthday") return profile.birthday?.year !== undefined;
  return typeof value === "string" && value.trim() !== "";
}

/** Whole years between a birthday and now (UTC). */
function ageOn(now: number, birthday: { year: number; month: number; day: number }): number {
  const today = new Date(now);
  const month = today.getUTCMonth() + 1;
  const beforeBirthday =
    month < birthday.month || (month === birthday.month && today.getUTCDate() < birthday.day);
  return today.getUTCFullYear() - birthday.year - (beforeBirthday ? 1 : 0);
}

/** The columns of the `users` row a sign-up fills in, from the request's `profile` object. */
function profileColumns(ctx: Ctx, profile: SignupProfile) {
  const { changes } = profileFieldChanges(ctx, {
    ...(profile.about !== undefined ? { about: profile.about } : {}),
    ...(profile.location !== undefined ? { location: profile.location } : {}),
    ...(profile.website !== undefined ? { website: profile.website } : {}),
    ...(profile.birthday !== undefined ? { birthday: profile.birthday } : {}),
    socials: {
      ...(profile.discord !== undefined ? { discord: profile.discord } : {}),
      ...(profile.telegram !== undefined ? { telegram: profile.telegram } : {}),
      ...(profile.x !== undefined ? { x: profile.x } : {}),
    },
  });
  return changes;
}

/** The pieces of a request's `profile` object the site asks for; anything else is ignored. */
function parseProfile(settings: Settings, body: unknown): SignupProfile {
  const sent = (body as { profile?: unknown } | null | undefined)?.profile;
  const given: Record<string, unknown> =
    typeof sent === "object" && sent !== null ? (sent as Record<string, unknown>) : {};
  const asked: Record<string, unknown> = {};
  for (const field of signupFields(settings))
    if (given[field] !== undefined) asked[field] = given[field];
  const parsed = SignupProfile.safeParse(asked);
  if (!parsed.success)
    throw refuse(
      "BAD_REQUEST",
      "INVALID_PROFILE_FIELD",
      parsed.error.issues[0]?.message ?? "A profile field is not valid.",
    );
  return parsed.data;
}

/** What the site decided for one sign-up request, read from the settings once. */
export interface SignupPlan {
  /** The new account must confirm its email address (the site sends account email and asks it). */
  confirms: boolean;
  /** The columns of the new `users` row that the asked profile fields fill in. */
  columns: Record<string, string | number | null>;
}

/**
 * The site's registration rules for one sign-up request: refused when registration is closed,
 * when a required field is missing or malformed, or when the visitor is under the minimum age
 * (counted in whole years by the UTC calendar day). Throws before anything is written, so a
 * refused visitor leaves no account. Only the fields the site asks are read; any other key of the
 * request's `profile` is ignored, as it was before the settings existed.
 */
export function planSignup(ctx: Ctx, body: unknown, mailEnabled: boolean): SignupPlan {
  const settings = readSiteSettings(ctx);
  if (!settings.registrationOpen)
    throw refuse("FORBIDDEN", "REGISTRATION_CLOSED", "Registration is closed.");
  const profile = parseProfile(settings, body);
  for (const field of signupFields(settings))
    if (!present(profile, field))
      throw refuse("BAD_REQUEST", "REGISTRATION_FIELD_REQUIRED", `The ${field} field is required.`);
  let columns: SignupPlan["columns"];
  try {
    columns = profileColumns(ctx, profile);
  } catch (error) {
    if (error instanceof ValidationError)
      throw refuse("BAD_REQUEST", "INVALID_PROFILE_FIELD", error.message);
    throw error;
  }
  const { birthday } = profile;
  if (settings.minimumAge > 0 && birthday?.year !== undefined) {
    const known = { year: birthday.year, month: birthday.month, day: birthday.day };
    if (ageOn(ctx.now(), known) < settings.minimumAge)
      throw refuse(
        "FORBIDDEN",
        "UNDER_MINIMUM_AGE",
        `You must be at least ${settings.minimumAge} years old to register.`,
      );
  }
  return { confirms: mailEnabled && settings.requireEmailConfirmation, columns };
}
