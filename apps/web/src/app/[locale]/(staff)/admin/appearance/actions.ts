"use server";

import {
  catalogImagesCreate,
  catalogImagesDelete,
  catalogImagesUpdate,
  paletteColorsCreate,
  paletteColorsDelete,
  paletteColorsUpdate,
} from "@sermo/core/contracts";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  saveInOrder,
  text,
  whole,
} from "../groups/form-errors";
import { IMAGE_KINDS, imageKind, PALETTE_KINDS, paletteKind } from "./kinds";

const IMAGE_FIELDS = ["name", "fileId", "placement", "position", "isActive"];
const COLOUR_FIELDS = ["name", "color", "foreground", "position", "isActive"];
const PLACEMENT = ["width", "left", "top", "scale"] as const;

// The accent is part of the site cache, and the pictures and colours are read on pages of every
// kind: all of them are renewed after any change.
function renew() {
  revalidateTag("site", { expire: 0 });
  revalidatePath("/", "layout");
}

type Fields = Record<string, string>;

// The backend's refusal of a frame picture with no opening it can measure. It carries no code of
// its own, so the message is what tells it apart from any other refusal of the form.
const unmeasured = (error: unknown) =>
  error instanceof SermoError &&
  error.code === "validation" &&
  /could not be measured/.test(error.message);

// A number typed with a decimal point allowed (a placement is in percent of the avatar box).
const decimal = (raw: string) =>
  /^-?\d{1,6}(\.\d{1,4})?$/.test(raw.trim()) ? Number(raw.trim()) : null;

// The four fields of a frame's placement. They are sent only when the administrator changed one
// from what the form showed (`before.<name>`), or, for a new frame, typed all four: a frame
// replaced with a new picture keeps no old numbers, it is measured again.
async function placementOf(
  formData: FormData,
  fields: Fields,
): Promise<
  { width: number; left: number; top: number; scale: number } | undefined
> {
  const t = await getTranslations("adminAppearance.errors");
  const typed = PLACEMENT.map((name) => text(formData, name).trim());
  if (typed.every((value) => value === "")) return undefined;
  const changed = PLACEMENT.some(
    (name, index) => typed[index] !== text(formData, `before.${name}`).trim(),
  );
  if (!changed) return undefined;
  const numbers = typed.map(decimal);
  if (numbers.some((value) => value === null)) {
    fields.placement = t("placementNumbers");
    return undefined;
  }
  const [width, left, top, scale] = numbers as number[];
  return { width, left, top, scale };
}

// A new picture of a catalog (no id) or a change of one. A new `fileId` is the picture uploaded
// first; a frame's placement is the measured one unless the numbers were changed.
export async function saveImage(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = imageKind(text(formData, "kind"));
  if (kind === null) return { error: t("kind") };
  const raw = text(formData, "id");
  const imageId = raw === "" ? null : parseId(raw);
  if (raw !== "" && imageId === null) return { error: t("id") };
  const fields: Fields = {};
  const typedFile = text(formData, "fileId");
  const fileId = typedFile === "" ? undefined : parseId(typedFile);
  if (fileId === null) fields.fileId = t("file");
  const typedPosition = text(formData, "position").trim();
  const position = typedPosition === "" ? undefined : whole(typedPosition);
  if (position === null) fields.position = t("whole");
  const reset = kind === "frame" && text(formData, "intent") === "reset";
  const placement =
    kind === "frame" && !reset
      ? await placementOf(formData, fields)
      : undefined;
  if (Object.keys(fields).length > 0) return { fields };
  const name = text(formData, "name");
  const isActive = formData.get("isActive") !== null;
  try {
    if (imageId === null) {
      if (fileId == null) return { fields: { fileId: t("fileRequired") } };
      await call(catalogImagesCreate, {
        kind,
        name,
        fileId,
        ...(placement && { placement }),
        ...(position != null && { position }),
        isActive,
      });
    } else {
      await call(catalogImagesUpdate, {
        imageId,
        name,
        ...(fileId != null && { fileId }),
        ...(reset && { placement: null }),
        ...(placement && { placement }),
        ...(position != null && { position }),
        isActive,
      });
    }
  } catch (error) {
    // The placement fields are shown with a line of their own; the picture stays chosen.
    if (kind === "frame" && unmeasured(error)) {
      return { fields: { placementNeeded: t("placementNeeded") } };
    }
    return formFailure(error, IMAGE_FIELDS);
  }
  renew();
  redirect(
    `${IMAGE_KINDS[kind].path}?notice=${imageId === null ? "created" : reset ? "reset" : "saved"}`,
  );
}

// The active switch of a row: the entry's state alone. The page is drawn again with the new state;
// a refusal (an entry with no picture cannot be active) shows under the row.
export async function setImageActive(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const imageId = parseId(text(formData, "id"));
  if (imageId === null || imageKind(text(formData, "kind")) === null)
    return { error: t("id") };
  try {
    await call(catalogImagesUpdate, {
      imageId,
      isActive: text(formData, "active") === "1",
    });
  } catch (error) {
    return formFailure(error, []);
  }
  renew();
  return null;
}

// "Save order" of a picture catalog: the entries whose number was changed from what the page showed
// (`before.<id>`), each saved on its own.
export async function saveImageOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = imageKind(text(formData, "kind"));
  if (kind === null) return { error: t("kind") };
  const changes = await changesOf(formData, (imageId, position) =>
    call(catalogImagesUpdate, { imageId, position }),
  );
  if ("state" in changes) return changes.state;
  const { saved, state } = await saveInOrder(changes);
  if (saved > 0) renew();
  if (state) return state;
  redirect(`${IMAGE_KINDS[kind].path}?notice=ordered`);
}

// The changes of an order form: one per `position.<id>` field whose number differs from
// `before.<id>`, named by `title.<id>` in a refusal. Or the state to answer with when a field is
// not a record or a whole number.
async function changesOf(
  formData: FormData,
  save: (id: number, position: number) => Promise<unknown>,
): Promise<OrderChange[] | { state: StaffFormState }> {
  const t = await getTranslations("adminAppearance.errors");
  const changes: OrderChange[] = [];
  const fields: Fields = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("position.") || typeof value !== "string") continue;
    const id = parseId(name.slice("position.".length));
    if (id === null) return { state: { error: t("id") } };
    if (value.trim() === text(formData, `before.${id}`).trim()) continue;
    const position = whole(value);
    if (position === null) fields[name] = t("whole");
    else {
      changes.push({
        title: text(formData, `title.${id}`) || `#${id}`,
        save: () => save(id, position),
      });
    }
  }
  return Object.keys(fields).length > 0 ? { state: { fields } } : changes;
}

// Delete a picture; one still in use is deactivated by the backend and keeps its file.
export async function deleteImage(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = imageKind(text(formData, "kind"));
  const imageId = parseId(text(formData, "id"));
  if (kind === null || imageId === null) return { error: t("id") };
  let deactivated: boolean;
  try {
    ({ deactivated } = await call(catalogImagesDelete, { imageId }));
  } catch (error) {
    return formFailure(error, []);
  }
  renew();
  redirect(
    `${IMAGE_KINDS[kind].path}?notice=${deactivated ? "deactivated" : "deleted"}`,
  );
}

// A new colour of a palette (no id) or a change of one. The value is sent as typed: the backend
// holds the format. Only an accent has a foreground.
export async function saveColour(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = paletteKind(text(formData, "kind"));
  if (kind === null) return { error: t("kind") };
  const raw = text(formData, "id");
  const colorId = raw === "" ? null : parseId(raw);
  if (raw !== "" && colorId === null) return { error: t("id") };
  const typedPosition = text(formData, "position").trim();
  const position = typedPosition === "" ? undefined : whole(typedPosition);
  if (position === null) return { fields: { position: t("whole") } };
  const input = {
    name: text(formData, "name"),
    color: text(formData, "color").trim(),
    ...(kind === "accent" && {
      foreground: text(formData, "foreground").trim(),
    }),
    ...(position != null && { position }),
    isActive: formData.get("isActive") !== null,
  };
  try {
    if (colorId === null) await call(paletteColorsCreate, { kind, ...input });
    else await call(paletteColorsUpdate, { colorId, ...input });
  } catch (error) {
    return formFailure(error, COLOUR_FIELDS);
  }
  renew();
  redirect(
    `${PALETTE_KINDS[kind].path}?notice=${colorId === null ? "created" : "saved"}`,
  );
}

// The active switch of a colour row.
export async function setColourActive(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const colorId = parseId(text(formData, "id"));
  if (colorId === null || paletteKind(text(formData, "kind")) === null)
    return { error: t("id") };
  try {
    await call(paletteColorsUpdate, {
      colorId,
      isActive: text(formData, "active") === "1",
    });
  } catch (error) {
    return formFailure(error, []);
  }
  renew();
  return null;
}

// "Save order" of a colour palette, as `saveImageOrder` is for the pictures.
export async function saveColourOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = paletteKind(text(formData, "kind"));
  if (kind === null) return { error: t("kind") };
  const changes = await changesOf(formData, (colorId, position) =>
    call(paletteColorsUpdate, { colorId, position }),
  );
  if ("state" in changes) return changes.state;
  const { saved, state } = await saveInOrder(changes);
  if (saved > 0) renew();
  if (state) return state;
  redirect(`${PALETTE_KINDS[kind].path}?notice=ordered`);
}

// Delete a colour; one still in use is deactivated by the backend.
export async function deleteColour(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminAppearance.errors");
  const kind = paletteKind(text(formData, "kind"));
  const colorId = parseId(text(formData, "id"));
  if (kind === null || colorId === null) return { error: t("id") };
  let deactivated: boolean;
  try {
    ({ deactivated } = await call(paletteColorsDelete, { colorId }));
  } catch (error) {
    return formFailure(error, []);
  }
  renew();
  redirect(
    `${PALETTE_KINDS[kind].path}?notice=${deactivated ? "deactivated" : "deleted"}`,
  );
}
