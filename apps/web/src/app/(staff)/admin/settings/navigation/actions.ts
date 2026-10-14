"use server";

import {
  NavigationAudience,
  NavigationIconPosition,
  NavigationLocation,
  navigationCreate,
  navigationDelete,
  navigationList,
  navigationUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  saveInOrder,
  text,
  whole,
} from "../../groups/form-errors";

const BACK = "/admin/settings/navigation";

// The header, the phone bar, the account menu and the footer ask for the navigation on every
// request, as the visitor, so nothing is cached and a change shows at once.
function done(notice: "saved" | "added" | "deleted"): never {
  redirect(`${BACK}?${new URLSearchParams({ notice })}`);
}

const NAMES = [
  "location",
  "parentId",
  "title",
  "target",
  "position",
  "audience",
  "permission",
  "icon",
  "iconPosition",
];

// The icon chosen in the picker ("" is none) and which side of the title it sits on.
function iconOf(formData: FormData) {
  const position = NavigationIconPosition.safeParse(
    text(formData, "iconPosition") || "before",
  );
  return {
    icon: text(formData, "icon") || null,
    iconPosition: position.success ? position.data : undefined,
  };
}

// The audience and the permission it needs: the permission only goes with its audience.
async function audienceOf(formData: FormData): Promise<
  | { fail: StaffFormState; audience?: undefined; permission?: undefined }
  | {
      fail?: undefined;
      audience: (typeof NavigationAudience.options)[number];
      permission: string | null;
    }
> {
  const t = await getTranslations("adminSetup.errors");
  const audience = NavigationAudience.safeParse(text(formData, "audience"));
  if (!audience.success)
    return { fail: { fields: { audience: t("missing") } } };
  const permission = text(formData, "permission").trim();
  if (audience.data === "permission" && permission === "") {
    return { fail: { fields: { permission: t("permission") } } };
  }
  return {
    audience: audience.data,
    permission: audience.data === "permission" ? permission : null,
  };
}

export async function addEntry(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const location = NavigationLocation.safeParse(text(formData, "location"));
  if (!location.success) return { fields: { location: t("missing") } };
  const parent = text(formData, "parentId");
  const parentId = parent === "" ? null : parseId(parent);
  if (parent !== "" && parentId === null)
    return { fields: { parentId: t("id") } };
  // Empty leaves the order to the backend's own default.
  const typed = text(formData, "position").trim();
  const position = typed === "" ? undefined : whole(typed);
  if (position === null) return { fields: { position: t("number") } };
  const who = await audienceOf(formData);
  if (who.fail) return who.fail;
  const target = text(formData, "target").trim();
  try {
    await call(navigationCreate, {
      location: location.data,
      parentId,
      title: text(formData, "title"),
      target: target === "" ? null : target,
      ...(position !== undefined && { position }),
      isEnabled: formData.get("isEnabled") !== null,
      audience: who.audience,
      permission: who.permission,
      ...iconOf(formData),
    });
  } catch (error) {
    return formFailure(error, NAMES);
  }
  done("added");
}

// One entry's own fields. The order is saved by `saveOrder`, never here.
export async function saveEntry(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const entryId = parseId(text(formData, "id"));
  if (entryId === null) return { error: t("id") };
  const who = await audienceOf(formData);
  if (who.fail) return who.fail;
  try {
    await call(navigationUpdate, {
      entryId,
      title: text(formData, "title"),
      isEnabled: formData.get("isEnabled") !== null,
      audience: who.audience,
      permission: who.permission,
      ...iconOf(formData),
    });
  } catch (error) {
    return formFailure(error, NAMES);
  }
  done("saved");
}

// Every order field of the list in one submit (`position.<id>`): only the entries whose number
// changed are sent.
export async function saveOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const { items } = await call(navigationList, {});
  const stored = new Map(items.map((item) => [item.id, item.position]));
  const titles = new Map(items.map((item) => [item.id, item.title]));
  const changes: OrderChange[] = [];
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("position.") || typeof value !== "string") continue;
    const entryId = parseId(name.slice("position.".length));
    if (entryId === null || !stored.has(entryId)) return { error: t("id") };
    const position = whole(value);
    if (position === null) return { error: t("number") };
    if (position !== stored.get(entryId)) {
      changes.push({
        title: titles.get(entryId) ?? `#${entryId}`,
        save: () => call(navigationUpdate, { entryId, position }),
      });
    }
  }
  const { state } = await saveInOrder(changes);
  if (state) return state;
  done("saved");
}

export async function deleteEntry(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminSetup.errors");
  const entryId = parseId(text(formData, "id"));
  if (entryId === null) return { error: t("id") };
  try {
    await call(navigationDelete, { entryId });
  } catch (error) {
    return formFailure(error, []);
  }
  done("deleted");
}
