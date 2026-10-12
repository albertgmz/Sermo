import type { Ctx } from "../../context";
import { profilesUpdate } from "../../contracts/profiles";
import { ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { readSiteSettings } from "../settings";
import { renderSignature } from "./signature";

/** The calendar day of a birthday, checked against the month and, with a year, the real calendar. */
function checkBirthday(now: number, birthday: { year?: number; month: number; day: number }): void {
  const { year, month, day } = birthday;
  // Without a year, February 29 is allowed: the member simply has a leap-day birthday.
  const probe = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day)
    throw new ValidationError("That date does not exist.");
  if (year !== undefined && probe.getTime() > now)
    throw new ValidationError("A birthday cannot be in the future.");
}
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are stripped
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\ufeff]/g;
/** A title with its whitespace collapsed and its control and invisible characters removed. */
const cleanTitle = (title: string) =>
  title
    .replace(/[\t-\r]/g, " ")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
const two = (value: number) => String(value).padStart(2, "0");

/** The profile fields a member (or an administrator for them) can set. */
export interface ProfileFieldsInput {
  about?: string;
  location?: string;
  website?: string;
  birthday?: { year?: number; month: number; day: number } | null;
  socials?: { discord?: string; telegram?: string; x?: string };
  customTitle?: string | null;
  signature?: string | null;
}

/**
 * Checks each profile field that was sent and returns the columns to store. Setting a title or
 * a signature (as opposed to clearing it) calls `mayShow.customTitle` / `mayShow.signature` at
 * the point it is validated; the caller supplies the permission those need (an administrator
 * editing another member supplies none). The signature is rendered here, so call this before
 * opening the write transaction.
 */
export function profileFieldChanges(
  ctx: Ctx,
  input: ProfileFieldsInput,
  mayShow: { customTitle?: () => void; signature?: () => void } = {},
) {
  const settings = readSiteSettings(ctx);
  const changes: Record<string, string | number | null> = {};
  if (input.about !== undefined) changes.about = input.about;
  if (input.location !== undefined) changes.location = input.location;
  if (input.website !== undefined) {
    const website = profilesUpdate.input.shape.website.safeParse(input.website);
    if (!website.success)
      throw new ValidationError(website.error.issues[0]?.message ?? "Use an http(s) URL.");
    changes.website = input.website;
  }
  if (input.birthday !== undefined) {
    if (input.birthday === null) {
      changes.birthday_md = null;
      changes.birth_year = null;
    } else {
      checkBirthday(ctx.now(), input.birthday);
      changes.birthday_md = `${two(input.birthday.month)}-${two(input.birthday.day)}`;
      changes.birth_year = input.birthday.year ?? null;
    }
  }
  if (input.socials?.discord !== undefined) changes.social_discord = input.socials.discord;
  if (input.socials?.telegram !== undefined) changes.social_telegram = input.socials.telegram;
  if (input.socials?.x !== undefined) changes.social_x = input.socials.x;
  // Clearing a title or a signature is always allowed; setting one needs its permission.
  let settingTitle = false;
  let settingSignature = false;
  if (input.customTitle !== undefined) {
    const title = cleanTitle(input.customTitle ?? "");
    if (title.length > settings.customTitleMaxLength)
      throw new ValidationError(
        `A title is at most ${settings.customTitleMaxLength} characters long.`,
      );
    settingTitle = title !== "";
    if (settingTitle) mayShow.customTitle?.();
    changes.custom_title = title === "" ? null : title;
  }
  if (input.signature !== undefined) {
    const source = input.signature?.trim() ?? "";
    settingSignature = source !== "";
    if (settingSignature) mayShow.signature?.();
    if (source.length > settings.signatureMaxLength)
      throw new ValidationError(
        `A signature is at most ${settings.signatureMaxLength} characters long.`,
      );
    if (source.split(/\r\n|\r|\n/).length > settings.signatureMaxLines)
      throw new ValidationError(`A signature is at most ${settings.signatureMaxLines} lines long.`);
    // Rendered before the transaction opens.
    changes.signature_source = source === "" ? null : source;
    changes.signature_html = source === "" ? null : renderSignature(source);
  }
  return { changes, settingTitle, settingSignature };
}

/** Stores the columns `profileFieldChanges` returned. Call inside the write transaction. */
export function storeProfileChanges(
  ctx: Ctx,
  userId: number,
  changes: Record<string, string | number | null>,
): void {
  const columns = Object.keys(changes);
  if (columns.length === 0) return;
  ctx.sqlite
    .prepare(
      `UPDATE users SET ${columns.map((column, i) => `${column} = ?${i + 3}`).join(", ")}, content_updated_at = ?2 WHERE id = ?1`,
    )
    .run(userId, ctx.now(), ...columns.map((column) => changes[column]!));
  publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: userId });
}
