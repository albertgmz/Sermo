"use server";

import {
  bansCreate,
  bansLift,
  Restriction,
  restrictionsCreate,
  restrictionsLift,
  threadBansLift,
  warningsCreate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../../../groups/form-errors";
import { memberOf, ticked } from "../../action-helpers";

const KINDS = Restriction.shape.kind.options;
const DAY = 24 * 60 * 60 * 1000;

// A number of days typed in a form, as the end of the sanction: undefined for an empty field,
// null for a value that is not a number of days (or too many to be a date), else the ISO time
// that many days from now. What counts as an acceptable length is the backend's to say.
function endsAfter(
  formData: FormData,
  name: string,
): string | undefined | null {
  const raw = text(formData, name).trim();
  if (raw === "") return undefined;
  const days = whole(raw);
  if (days === null) return null;
  const end = new Date(Date.now() + days * DAY);
  return Number.isNaN(end.getTime()) ? null : end.toISOString();
}

// What every moderation write may carry besides its own fields.
function notice(formData: FormData) {
  const message = text(formData, "message").trim();
  return {
    notify: ticked(formData, "notify"),
    ...(message === "" ? {} : { message }),
  };
}

const back = (userId: number, notice: string) =>
  `/admin/users/${userId}/sanctions?notice=${notice}`;

export async function issueWarning(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const points = whole(text(formData, "points"));
  if (points === null) return { fields: { points: t("points") } };
  const expiresAt = endsAfter(formData, "days");
  if (expiresAt === null) return { fields: { days: t("days") } };
  try {
    await call(warningsCreate, {
      userId,
      points,
      reason: text(formData, "reason"),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...notice(formData),
    });
  } catch (error) {
    return formFailure(error, ["points", "reason", "message"]);
  }
  redirect(back(userId, "warned"));
}

export async function addRestriction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const kind = text(formData, "kind");
  if (userId === null || !(KINDS as readonly string[]).includes(kind)) {
    return { error: t("id") };
  }
  const expiresAt = endsAfter(formData, "days");
  if (expiresAt === null) return { fields: { days: t("days") } };
  try {
    await call(restrictionsCreate, {
      userId,
      kind: kind as (typeof KINDS)[number],
      reason: text(formData, "reason"),
      expiresAt: expiresAt ?? null,
      ...notice(formData),
    });
  } catch (error) {
    return formFailure(error, ["reason", "message"]);
  }
  redirect(back(userId, "restricted"));
}

export async function liftRestriction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const restrictionId = parseId(text(formData, "restrictionId"));
  if (userId === null || restrictionId === null) return { error: t("id") };
  try {
    await call(restrictionsLift, {
      restrictionId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(back(userId, "restrictionLifted"));
}

export async function banMember(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const permanent = ticked(formData, "permanent");
  const expiresAt = permanent ? null : endsAfter(formData, "days");
  if (expiresAt === null && !permanent) return { fields: { days: t("days") } };
  if (expiresAt === undefined)
    return { fields: { days: t("daysOrPermanent") } };
  try {
    await call(bansCreate, {
      userId,
      reason: text(formData, "reason"),
      expiresAt,
      ...notice(formData),
    });
  } catch (error) {
    return formFailure(error, ["reason", "message"]);
  }
  redirect(back(userId, "banned"));
}

// Lifts a ban. Used from the member's Sanctions tab and from the ban register: the form carries
// the address to return to as one of two known pages, never a path.
export async function liftBan(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const banId = parseId(text(formData, "banId"));
  const userId = memberOf(formData);
  if (banId === null) return { error: t("id") };
  try {
    await call(bansLift, {
      banId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(
    userId === null ? "/admin/bans?notice=lifted" : back(userId, "banLifted"),
  );
}

export async function liftThreadBan(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const threadId = parseId(text(formData, "threadId"));
  if (userId === null || threadId === null) return { error: t("id") };
  try {
    await call(threadBansLift, {
      threadId,
      userId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(back(userId, "threadBanLifted"));
}
