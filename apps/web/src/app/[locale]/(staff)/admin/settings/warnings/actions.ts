"use server";

import {
  Restriction,
  warningActionsCreate,
  warningActionsDelete,
  warningActionsUpdate,
  warningTypesCreate,
  warningTypesDelete,
  warningTypesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../../groups/form-errors";

const BACK = "/admin/settings/warnings";
const TYPE_FIELDS = [
  "nameEn",
  "nameEs",
  "points",
  "expiryDays",
  "defaultReason",
];
const ACTION_FIELDS = [
  "threshold",
  "kind",
  "days",
  "groupId",
  "restrictionKind",
  "actorPassword",
];
const KINDS = warningActionsCreate.input.shape.kind.options;
const RESTRICTIONS = Restriction.shape.kind.options;

type Fields = Record<string, string>;

// A whole number typed in a field: undefined when it was left empty, null (with the field's
// message in `fields`) when it is not a whole number.
async function number(
  formData: FormData,
  name: string,
  fields: Fields,
): Promise<number | null | undefined> {
  const typed = text(formData, name).trim();
  if (typed === "") return undefined;
  const value = whole(typed);
  if (value === null) {
    fields[name] = (await getTranslations("adminSetup.errors"))("number");
  }
  return value;
}

// A new type (no id) or a change of one; every field the form shows is sent. An empty expiry
// is a type whose warnings never expire.
export async function saveWarningType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const raw = text(formData, "id");
  const typeId = raw === "" ? null : parseId(raw);
  if (raw !== "" && typeId === null) return { error: t("id") };
  const fields: Fields = {};
  const points = await number(formData, "points", fields);
  const expiryDays = await number(formData, "expiryDays", fields);
  if (points === undefined) fields.points = t("number");
  if (Object.keys(fields).length > 0) return { fields };
  const input = {
    nameEn: text(formData, "nameEn"),
    nameEs: text(formData, "nameEs"),
    points: points as number,
    expiryDays: expiryDays ?? null,
    defaultReason: text(formData, "defaultReason"),
    locked: formData.get("locked") !== null,
  };
  try {
    if (typeId === null) await call(warningTypesCreate, input);
    else await call(warningTypesUpdate, { typeId, ...input });
  } catch (error) {
    return formFailure(error, TYPE_FIELDS);
  }
  redirect(`${BACK}?notice=${typeId === null ? "added" : "saved"}`);
}

export async function deleteWarningType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const typeId = parseId(text(formData, "id"));
  if (typeId === null) return { error: t("id") };
  try {
    await call(warningTypesDelete, { typeId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${BACK}?notice=deleted`);
}

// A new action (no id) or a change of one. The form shows the group and the restriction beside
// each other; only the one the kind uses is sent.
export async function saveWarningAction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const raw = text(formData, "id");
  const actionId = raw === "" ? null : parseId(raw);
  if (raw !== "" && actionId === null) return { error: t("id") };
  const kind = KINDS.find((name) => name === text(formData, "kind"));
  const fields: Fields = {};
  if (!kind) fields.kind = t("missing");
  const threshold = await number(formData, "threshold", fields);
  const days = await number(formData, "days", fields);
  if (threshold === undefined) fields.threshold = t("number");
  // The length is chosen: a number of days, or permanent ticked. Empty never means permanent.
  const permanent = formData.get("permanent") !== null;
  if (!permanent && days === undefined) fields.days = t("daysOrPermanent");
  const groupId = kind === "group" ? parseId(text(formData, "groupId")) : null;
  if (kind === "group" && groupId === null) fields.groupId = t("missing");
  const restrictionKind =
    kind === "restriction"
      ? (RESTRICTIONS.find(
          (name) => name === text(formData, "restrictionKind"),
        ) ?? null)
      : null;
  if (kind === "restriction" && restrictionKind === null)
    fields.restrictionKind = t("missing");
  if (Object.keys(fields).length > 0 || !kind) return { fields };
  const input = {
    threshold: threshold as number,
    kind,
    days: permanent ? null : (days as number),
    groupId,
    restrictionKind,
    // Only an action that adds a group needs it; the backend says so for the others.
    ...(text(formData, "actorPassword") === ""
      ? {}
      : { actorPassword: text(formData, "actorPassword") }),
  };
  try {
    if (actionId === null) await call(warningActionsCreate, input);
    else await call(warningActionsUpdate, { actionId, ...input });
  } catch (error) {
    return formFailure(error, ACTION_FIELDS);
  }
  redirect(`${BACK}?notice=${actionId === null ? "added" : "saved"}`);
}

export async function deleteWarningAction(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const actionId = parseId(text(formData, "id"));
  if (actionId === null) return { error: t("id") };
  try {
    const actorPassword = text(formData, "actorPassword");
    await call(warningActionsDelete, {
      actionId,
      ...(actorPassword === "" ? {} : { actorPassword }),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${BACK}?notice=deleted`);
}
