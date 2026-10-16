"use server";

import {
  forumTabsCreate,
  forumTabsDelete,
  forumTabsUpdate,
  imagesSetNodeCover,
  imagesSetNodeIcon,
  nodesCreate,
  nodesSetModerator,
  nodesUpdate,
  threadPrefixesCreate,
  threadPrefixesDelete,
  threadPrefixesUpdate,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  missingPassword,
  type OrderChange,
  saveInOrder,
  text,
  whole,
} from "../groups/form-errors";

const NODE_FIELDS = [
  "type",
  "parentId",
  "title",
  "description",
  "position",
  "tabId",
  "iconKey",
  "minAccountAgeDays",
  "minPostCount",
];

// What the public forum list shows comes from the node tree: the pages that show it are renewed.
const renewPublic = () => revalidatePath("/", "layout");

type Fields = Record<string, string>;

// A whole number typed in a field of the form: undefined when it was left empty, null (with the
// field's message in `fields`) when it is not a whole number.
async function number(
  formData: FormData,
  name: string,
  fields: Fields,
): Promise<number | null | undefined> {
  const typed = text(formData, name).trim();
  if (typed === "") return undefined;
  const value = whole(typed);
  if (value === null) {
    fields[name] = (await getTranslations("adminForums.errors"))("whole");
  }
  return value;
}

// An optional id chosen in a select: "" is none (null), anything else must be an id.
async function optionalId(
  formData: FormData,
  name: string,
  fields: Fields,
): Promise<number | null | undefined> {
  const typed = text(formData, name);
  if (typed === "") return null;
  const id = parseId(typed);
  if (id === null) {
    fields[name] = (await getTranslations("adminForums.errors"))("choice");
    return undefined;
  }
  return id;
}

// The rules of posting as the editor shows them: four switches and two counts.
async function settingsOf(formData: FormData, fields: Fields) {
  const minAccountAgeDays = await number(formData, "minAccountAgeDays", fields);
  const minPostCount = await number(formData, "minPostCount", fields);
  return {
    requireThreadApproval: formData.get("requireThreadApproval") !== null,
    requireReplyApproval: formData.get("requireReplyApproval") !== null,
    isReadOnly: formData.get("isReadOnly") !== null,
    // The switch is in the form only for a forum: left out, the setting stays as it is.
    ...(formData.get("hasCountsPosts") !== null && {
      countsPosts: formData.get("countsPosts") !== null,
    }),
    ...(minAccountAgeDays != null && { minAccountAgeDays }),
    ...(minPostCount != null && { minPostCount }),
  };
}

// A new category or forum. The type comes from the form that was used; the backend decides what a
// parent may be.
export async function createNode(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const type = text(formData, "type");
  if (type !== "category" && type !== "forum") return { error: t("type") };
  const fields: Fields = {};
  const parentId = await optionalId(formData, "parentId", fields);
  const tabId = await optionalId(formData, "tabId", fields);
  const position = await number(formData, "position", fields);
  if (Object.keys(fields).length > 0) return { fields };
  let saved: number;
  try {
    saved = (
      await call(nodesCreate, {
        type,
        parentId: parentId ?? null,
        title: text(formData, "title"),
        description: text(formData, "description"),
        ...(position != null && { position }),
        ...(formData.has("iconKey") && {
          iconKey: text(formData, "iconKey") || null,
        }),
        // A tab belongs to a root category: the field is only in the form for one.
        ...(tabId != null && { tabId }),
      })
    ).id;
  } catch (error) {
    return formFailure(error, NODE_FIELDS);
  }
  renewPublic();
  redirect(`/admin/forums/${saved}?notice=created`);
}

// Every field of the editor. The tab field is in the form only for a root node.
export async function saveNode(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const nodeId = parseId(text(formData, "id"));
  if (nodeId === null) return { error: t("id") };
  const fields: Fields = {};
  const parentId = await optionalId(formData, "parentId", fields);
  const position = await number(formData, "position", fields);
  const settings = await settingsOf(formData, fields);
  const tabId =
    formData.get("hasTab") === null
      ? undefined
      : await optionalId(formData, "tabId", fields);
  if (Object.keys(fields).length > 0) return { fields };
  try {
    await call(nodesUpdate, {
      nodeId,
      parentId: parentId ?? null,
      title: text(formData, "title"),
      description: text(formData, "description"),
      ...(position != null && { position }),
      ...(formData.has("iconKey") && {
        iconKey: text(formData, "iconKey") || null,
      }),
      ...(tabId !== undefined && { tabId }),
      settings,
    });
  } catch (error) {
    return formFailure(error, NODE_FIELDS);
  }
  renewPublic();
  redirect(`/admin/forums/${nodeId}?notice=saved`);
}

// The order boxes of the tree: only the nodes whose number was changed are sent.
export async function saveOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const changes: OrderChange[] = [];
  for (const [key] of formData) {
    if (!key.startsWith("position:")) continue;
    const nodeId = parseId(key.slice("position:".length));
    const position = whole(text(formData, key));
    if (nodeId === null || position === null) return { error: t("order") };
    if (position !== whole(text(formData, `before:${nodeId}`))) {
      changes.push({
        title: text(formData, `title:${nodeId}`) || `#${nodeId}`,
        save: () => call(nodesUpdate, { nodeId, position }),
      });
    }
  }
  const { saved, state } = await saveInOrder(changes);
  // What was saved before a refusal is on the public pages too.
  if (saved > 0) renewPublic();
  if (state) return state;
  redirect("/admin/forums?notice=ordered");
}

// Icon and cover of one node: a new file is attached, a removal sends null, nothing chosen sends
// nothing.
export async function saveNodePictures(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const nodeId = parseId(text(formData, "id"));
  if (nodeId === null) return { error: t("id") };
  const fields: Fields = {};
  const todo: {
    operation: typeof imagesSetNodeIcon | typeof imagesSetNodeCover;
    fileId: number | null;
  }[] = [];
  for (const [name, operation] of [
    ["icon", imagesSetNodeIcon],
    ["cover", imagesSetNodeCover],
  ] as const) {
    if (text(formData, `${name}Remove`) === "1") {
      todo.push({ operation, fileId: null });
      continue;
    }
    const typed = text(formData, name);
    if (typed === "") continue;
    const fileId = parseId(typed);
    if (fileId === null) fields[name] = t("file");
    else todo.push({ operation, fileId });
  }
  if (Object.keys(fields).length > 0) return { fields };
  if (todo.length === 0) return { error: t("nothingChosen") };
  for (const { operation, fileId } of todo) {
    try {
      await call(operation, { nodeId, fileId });
    } catch (error) {
      return formFailure(error, []);
    }
  }
  renewPublic();
  redirect(`/admin/forums/${nodeId}?notice=pictures`);
}

// Add or remove a moderator of a forum; the member comes from the picker's hidden field.
export async function setModerator(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const nodeId = parseId(text(formData, "id"));
  const userId = parseId(text(formData, "userId"));
  if (nodeId === null || userId === null) return { error: t("id") };
  const remove = text(formData, "remove") === "1";
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    await call(nodesSetModerator, {
      nodeId,
      userId,
      remove,
      actorPassword: text(formData, "actorPassword"),
    });
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
  redirect(
    `/admin/forums/${nodeId}?notice=${remove ? "unmoderated" : "moderated"}#moderators`,
  );
}

// Forum list tabs ---------------------------------------------------------------------------

// A new tab (no id) or a change of one.
export async function saveTab(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const raw = text(formData, "id");
  const tabId = raw === "" ? null : parseId(raw);
  if (raw !== "" && tabId === null) return { error: t("id") };
  const fields: Fields = {};
  const position = await number(formData, "position", fields);
  if (Object.keys(fields).length > 0) return { fields };
  const input = {
    title: text(formData, "title"),
    ...(position != null && { position }),
  };
  try {
    if (tabId === null) await call(forumTabsCreate, input);
    else await call(forumTabsUpdate, { tabId, ...input });
  } catch (error) {
    return formFailure(error, ["title", "position"]);
  }
  renewPublic();
  redirect(
    `/admin/forums?notice=${tabId === null ? "tabAdded" : "tabSaved"}#tabs`,
  );
}

export async function deleteTab(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const tabId = parseId(text(formData, "id"));
  if (tabId === null) return { error: t("id") };
  try {
    await call(forumTabsDelete, { tabId });
  } catch (error) {
    return formFailure(error, []);
  }
  renewPublic();
  redirect("/admin/forums?notice=tabDeleted#tabs");
}

// Thread prefixes ----------------------------------------------------------------------------

const PREFIX_FIELDS = ["label", "colorId", "icon", "position", "isActive"];

// A new prefix (no id) or a change of one; every field the form shows is sent.
export async function savePrefix(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const raw = text(formData, "id");
  const prefixId = raw === "" ? null : parseId(raw);
  if (raw !== "" && prefixId === null) return { error: t("id") };
  const fields: Fields = {};
  const colorId = parseId(text(formData, "colorId"));
  if (colorId === null) fields.colorId = t("colour");
  const position = await number(formData, "position", fields);
  if (colorId === null || Object.keys(fields).length > 0) return { fields };
  const input = {
    label: text(formData, "label"),
    colorId,
    icon: text(formData, "icon"),
    ...(position != null && { position }),
    isActive: formData.get("isActive") !== null,
  };
  try {
    if (prefixId === null) await call(threadPrefixesCreate, input);
    else await call(threadPrefixesUpdate, { prefixId, ...input });
  } catch (error) {
    return formFailure(error, PREFIX_FIELDS);
  }
  renewPublic();
  redirect(
    `/admin/forums/prefixes?notice=${prefixId === null ? "created" : "saved"}`,
  );
}

export async function deletePrefix(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminForums.errors");
  const prefixId = parseId(text(formData, "id"));
  if (prefixId === null) return { error: t("id") };
  let deactivated: boolean;
  try {
    ({ deactivated } = await call(threadPrefixesDelete, { prefixId }));
  } catch (error) {
    return formFailure(error, []);
  }
  renewPublic();
  redirect(
    `/admin/forums/prefixes?notice=${deactivated ? "deactivated" : "deleted"}`,
  );
}
