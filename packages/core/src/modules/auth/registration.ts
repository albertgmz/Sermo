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

function parseProfile(body: unknown): SignupProfile {
  const sent = (body as { profile?: unknown } | null | undefined)?.profile;
  const parsed = SignupProfile.safeParse(sent ?? {});
  if (!parsed.success)
    throw refuse(
      "BAD_REQUEST",
      "INVALID_PROFILE_FIELD",
      parsed.error.issues[0]?.message ?? "A profile field is not valid.",
    );
  return parsed.data;
}

/**
 * The site's registration rules for one sign-up request: refused when registration is closed,
 * when a required field is missing or malformed, or when the visitor is under the minimum age.
 * Throws before anything is written, so a refused visitor leaves no account.
 */
export function checkSignup(ctx: Ctx, body: unknown): void {
  const settings = readSiteSettings(ctx);
  if (!settings.registrationOpen)
    throw refuse("FORBIDDEN", "REGISTRATION_CLOSED", "Registration is closed.");
  const profile = parseProfile(body);
  for (const field of signupFields(settings))
    if (!present(profile, field))
      throw refuse("BAD_REQUEST", "REGISTRATION_FIELD_REQUIRED", `The ${field} field is required.`);
  try {
    profileColumns(ctx, profile);
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
}

/**
 * The columns of the new `users` row that the request's profile fills in. Called once the account
 * exists, after `checkSignup` accepted the same body: a body that no longer passes (a setting
 * changed in between) fills in nothing rather than leaving an account without its forum row.
 */
export function signupColumns(ctx: Ctx, body: unknown): Record<string, string | number | null> {
  try {
    return profileColumns(ctx, parseProfile(body));
  } catch {
    return {};
  }
}
