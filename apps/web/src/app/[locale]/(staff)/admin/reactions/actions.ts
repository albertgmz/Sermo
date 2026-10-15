"use server";

import {
  reactionTypesCreate,
  reactionTypesList,
  reactionTypesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { Rule } from "@/components/staff/criteria-rule";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  ruleOf,
  ruleRefusal,
  saveInOrder,
  text,
  whole,
} from "../groups/form-errors";

const FIELDS = [
  "emoji",
  "title",
  "score",
  "position",
  "fileId",
  "frameWidth",
  "frameHeight",
  "frameCount",
  "rule",
  "forumIds",
];

const FRAME_FIELDS = ["frameWidth", "frameHeight", "frameCount"] as const;

// The picture and frame fields of the forms. `fileId` is the file uploaded just before (empty
// when none), `fileIdRemove` the picture field's remove control. A frame field left empty is
// undefined; one that is not a whole number is null.
function pictureFields(formData: FormData) {
  const typed = text(formData, "fileId");
  return {
    fileId: typed === "" ? undefined : parseId(typed),
    remove: text(formData, "fileIdRemove") === "1",
    frameWidth: optionalWhole(text(formData, "frameWidth")),
    frameHeight: optionalWhole(text(formData, "frameHeight")),
    frameCount: optionalWhole(text(formData, "frameCount")),
  };
}

// A number the form may leave empty: undefined then, so the backend applies its own.
function optionalWhole(raw: string): number | null | undefined {
  return raw.trim() === "" ? undefined : whole(raw);
}

// Who may give the type and where, from the rows of `AccessFields`: the rule, the forums
// (comma-separated ids, empty for everywhere) and what excluded members see. A form that does not
// carry a row leaves that part unsent, so the backend keeps (or defaults) it.
async function accessFields(formData: FormData): Promise<
  | {
      rule?: Rule;
      forumIds?: number[];
      hideWhenLocked?: boolean;
    }
  | { refused: StaffFormState }
> {
  const access: { rule?: Rule; forumIds?: number[]; hideWhenLocked?: boolean } =
    {};
  if (formData.has("rule")) {
    const rule = ruleOf(formData);
    if (rule === null) return { refused: await ruleRefusal(formData) };
    access.rule = rule;
  }
  if (formData.has("forumIds")) {
    const t = await getTranslations("adminContent.errors");
    const ids = text(formData, "forumIds")
      .split(",")
      .map((raw) => raw.trim())
      .filter((raw) => raw !== "")
      .map(parseId);
    if (ids.includes(null))
      return { refused: { fields: { forumIds: t("id") } } };
    access.forumIds = ids as number[];
  }
  if (formData.has("hideWhenLocked"))
    access.hideWhenLocked = text(formData, "hideWhenLocked") === "1";
  return access;
}

export async function createReactionType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const score = optionalWhole(text(formData, "score"));
  const position = optionalWhole(text(formData, "position"));
  const fields: Record<string, string> = {};
  const picture = pictureFields(formData);
  if (score === null) fields.score = t("number");
  if (position === null) fields.position = t("number");
  if (picture.fileId === null) fields.fileId = t("file");
  for (const name of FRAME_FIELDS)
    if (picture[name] === null) fields[name] = t("number");
  if (Object.keys(fields).length > 0) return { fields };
  const access = await accessFields(formData);
  if ("refused" in access) return access.refused;
  try {
    await call(reactionTypesCreate, {
      ...access,
      fileId: picture.fileId ?? undefined,
      frameWidth: picture.frameWidth ?? undefined,
      frameHeight: picture.frameHeight ?? undefined,
      frameCount: picture.frameCount ?? undefined,
      emoji: text(formData, "emoji"),
      title: text(formData, "title"),
      score: score ?? undefined,
      position: position ?? undefined,
      isActive: formData.get("isActive") !== null,
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect("/admin/reactions?notice=created");
}

export async function updateReactionType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const reactionTypeId = parseId(text(formData, "id"));
  if (reactionTypeId === null) return { error: t("id") };
  const score = whole(text(formData, "score"));
  if (score === null) return { fields: { score: t("number") } };
  const picture = pictureFields(formData);
  const fields: Record<string, string> = {};
  if (picture.fileId === null) fields.fileId = t("file");
  for (const name of FRAME_FIELDS)
    if (picture[name] === null) fields[name] = t("number");
  if (Object.keys(fields).length > 0) return { fields };
  const access = await accessFields(formData);
  if ("refused" in access) return access.refused;
  // A new file replaces the picture; the remove control takes it away, frames included.
  const file =
    picture.fileId != null
      ? { fileId: picture.fileId }
      : picture.remove
        ? { fileId: null }
        : {};
  // The row form always carries the frame fields: empty ones go back to the whole picture.
  const frames = formData.has("frameWidth")
    ? {
        frameWidth: picture.frameWidth ?? null,
        frameHeight: picture.frameHeight ?? null,
        frameCount: picture.frameCount ?? 1,
      }
    : {};
  try {
    await call(reactionTypesUpdate, {
      reactionTypeId,
      emoji: text(formData, "emoji"),
      title: text(formData, "title"),
      score,
      ...access,
      ...file,
      ...frames,
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect("/admin/reactions?notice=saved");
}

export async function setReactionTypeActive(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const reactionTypeId = parseId(text(formData, "id"));
  const active = text(formData, "active");
  if (reactionTypeId === null || (active !== "1" && active !== "0")) {
    return { error: t("id") };
  }
  try {
    await call(reactionTypesUpdate, {
      reactionTypeId,
      isActive: active === "1",
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(
    `/admin/reactions?notice=${active === "1" ? "activated" : "deactivated"}`,
  );
}

// The positions typed in the order form, as `position.<id>`. Only the types whose position
// changed are updated.
export async function saveReactionOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const wanted = new Map<number, number>();
  const fields: Record<string, string> = {};
  const prefix = "position.";
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(prefix) || typeof value !== "string") continue;
    const id = parseId(name.slice(prefix.length));
    if (id === null) return { error: t("id") };
    const position = whole(value);
    if (position === null) fields[name] = t("number");
    else wanted.set(id, position);
  }
  if (Object.keys(fields).length > 0) return { fields };
  const changes: OrderChange[] = [];
  try {
    const { items } = await call(reactionTypesList, {});
    for (const item of items) {
      const position = wanted.get(item.id);
      if (position === undefined || position === item.position) continue;
      changes.push({
        title: item.title,
        save: () =>
          call(reactionTypesUpdate, { reactionTypeId: item.id, position }),
      });
    }
  } catch (error) {
    return formFailure(error, []);
  }
  const { state } = await saveInOrder(changes);
  if (state) return state;
  redirect("/admin/reactions?notice=ordered");
}
