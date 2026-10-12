"use server";

import {
  appearanceSet,
  imagesSetAvatar,
  imagesSetCover,
  nodesUnwatch,
  notificationsPreferences,
  notificationsSetPreferences,
  notificationsTypes,
  preferencesUpdate,
  profilesUpdate,
  pushPublicKey,
  threadsUnwatch,
  usersChangeUsername,
  usersUnignore,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/app/(main)/account/action-form";
import { failedPath } from "@/app/(main)/account/notice";
import { call } from "@/lib/sermo/client";
import { isRecordId, parseId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";
import { isUploadPurpose } from "@/lib/sermo/upload";

const ACCOUNT = "/account";

// A mutation that worked: the pages that show the member are read again and the page the form
// was on opens at the section with a notice.
function done(notice: string, hash: string, path = ACCOUNT): never {
  revalidatePath("/", "layout");
  redirect(`${path}?notice=${notice}#${hash}`);
}

// For the buttons that have no form state: a refusal comes back as a notice in the section of the
// button, with the backend's words.
async function press(
  path: string,
  hash: string,
  notice: string,
  run: () => Promise<unknown>,
): Promise<never> {
  const result = await attempt(path, run);
  if (!result.ok) redirect(failedPath(path, hash, result.error));
  return done(notice, hash, path);
}

// A button whose bound argument is not what the page binds: nothing is asked of the backend.
async function pressInvalid(path: string, hash: string): Promise<never> {
  return redirect(failedPath(path, hash, await invalidArgument()));
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

// Pictures -------------------------------------------------------------------------------------
// A picture is uploaded by the route handler in ./picture/route.ts: its body is too large for an
// action.

export async function removePicture(kind: "avatar" | "cover") {
  if (!isUploadPurpose(kind)) return pressInvalid(ACCOUNT, "pictures");
  await press(ACCOUNT, kind, `${kind}Removed`, () =>
    call(kind === "avatar" ? imagesSetAvatar : imagesSetCover, {
      fileId: null,
    }),
  );
}

// Username -------------------------------------------------------------------------------------

export async function renameMember(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get("confirm") !== "on") {
    const t = await getTranslations("account.errors");
    return { error: t("unconfirmed") };
  }
  const renamed = await attempt(ACCOUNT, () =>
    call(usersChangeUsername, { username: text(formData, "username") }),
  );
  if (!renamed.ok) return { error: renamed.error };
  return done("username", "username");
}

// About and contact -----------------------------------------------------------------------------

// Day, month and year are blank together to clear the birthday. Anything else is sent as typed,
// so the backend says what is wrong with it; only a date the contract cannot express (a year with
// no day or month, or a day that is not a number) is answered here.
function birthdayOf(formData: FormData) {
  const [day, month, year] = ["day", "month", "year"].map((name) =>
    text(formData, name).trim(),
  );
  if (!day && !month && !year) return { birthday: null };
  const whole = /^\d{1,4}$/;
  if (!whole.test(day) || !whole.test(month) || (year && !whole.test(year))) {
    return null;
  }
  return {
    birthday: {
      day: Number(day),
      month: Number(month),
      ...(year ? { year: Number(year) } : {}),
    },
  };
}

export async function saveAbout(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const birthday = birthdayOf(formData);
  if (!birthday) {
    const t = await getTranslations("account.errors");
    return { error: t("birthdayIncomplete") };
  }
  const saved = await attempt(ACCOUNT, () =>
    call(profilesUpdate, {
      about: text(formData, "about"),
      location: text(formData, "location"),
      website: text(formData, "website"),
      socials: {
        discord: text(formData, "discord"),
        telegram: text(formData, "telegram"),
        x: text(formData, "x"),
      },
      ...birthday,
    }),
  );
  if (!saved.ok) return { error: saved.error };
  return done("about", "about");
}

export async function clearBirthday() {
  await press(ACCOUNT, "about", "birthdayRemoved", () =>
    call(profilesUpdate, { birthday: null }),
  );
}

// Title and signature: only the fields the form carries are sent; an empty one clears.
export async function saveTitleAndSignature(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const change: { customTitle?: string | null; signature?: string | null } = {};
  if (formData.has("customTitle"))
    change.customTitle = text(formData, "customTitle").trim() || null;
  if (formData.has("signature"))
    change.signature = text(formData, "signature").trim() || null;
  const saved = await attempt(ACCOUNT, () => call(profilesUpdate, change));
  if (!saved.ok) return { error: saved.error };
  return done("title", "title");
}

export async function clearTitle() {
  await press(ACCOUNT, "title", "titleRemoved", () =>
    call(profilesUpdate, { customTitle: null }),
  );
}

export async function clearSignature() {
  await press(ACCOUNT, "title", "signatureRemoved", () =>
    call(profilesUpdate, { signature: null }),
  );
}

// Appearance -----------------------------------------------------------------------------------

const WORN = {
  accent: "accentId",
  nameColor: "nameColorId",
  frame: "frameId",
  cover: "coverPresetId",
} as const;

export type AppearanceField = keyof typeof WORN;

export async function saveAppearance(
  field: AppearanceField,
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!Object.hasOwn(WORN, field)) return { error: await invalidArgument() };
  const raw = text(formData, "value");
  const id = raw === "" ? null : parseId(raw);
  if (raw !== "" && id === null) return { error: await invalidArgument() };
  const saved = await attempt("/account/appearance", () =>
    call(appearanceSet, { [WORN[field]]: id }),
  );
  if (!saved.ok) return { error: saved.error };
  revalidatePath("/", "layout");
  redirect(`/account/appearance?saved=${field}#${field}`);
}

// Privacy --------------------------------------------------------------------------------------

export async function savePrivacy(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const saved = await attempt("/account/privacy", () =>
    call(preferencesUpdate, {
      profileViewPrivacy: text(formData, "profileViewPrivacy") as "everyone",
      profilePostPrivacy: text(formData, "profilePostPrivacy") as "members",
    }),
  );
  if (!saved.ok) return { error: saved.error };
  return done("privacy", "privacy", "/account/privacy");
}

export async function stopIgnoring(userId: number) {
  if (!isRecordId(userId)) return pressInvalid("/account/privacy", "ignored");
  await press("/account/privacy", "ignored", "unignored", () =>
    call(usersUnignore, { userId }),
  );
}

// Notifications --------------------------------------------------------------------------------

const CHANNELS = ["inApp", "email", "push"] as const;

// Every cell is a checkbox named "<type>:<channel>". Only the cells that differ from what the
// member has now are sent, so a type they never touched keeps following its default.
export async function saveNotifications(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const path = "/account/notifications";
  const saved = await attempt(path, async () => {
    const [{ items: types }, { items: current }, push] = await Promise.all([
      call(notificationsTypes, {}),
      call(notificationsPreferences, {}),
      call(pushPublicKey, {}),
    ]);
    const now = new Map(current.map((entry) => [entry.type, entry]));
    const items = types.flatMap((type) => {
      if (type.required) return [];
      const change: Record<string, boolean> = {};
      for (const channel of CHANNELS) {
        if (!type.channels.includes(channel)) continue;
        // The page offers no push cell while push is off, so nothing was chosen for it.
        if (channel === "push" && push.publicKey === null) continue;
        const wanted = formData.get(`${type.id}:${channel}`) === "on";
        const held = now.get(type.id) ?? type.defaults;
        if (wanted !== held[channel]) change[channel] = wanted;
      }
      return Object.keys(change).length ? [{ type: type.id, ...change }] : [];
    });
    if (items.length) await call(notificationsSetPreferences, { items });
  });
  if (!saved.ok) return { error: saved.error };
  return done("notifications", "types", path);
}

// Preferences ----------------------------------------------------------------------------------

export async function savePreferences(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const path = "/account/preferences";
  const saved = await attempt(path, () =>
    call(preferencesUpdate, {
      watchOnCreate: text(formData, "watchOnCreate") as "none",
      watchOnReply: text(formData, "watchOnReply") as "none",
      language: text(formData, "language") || null,
    }),
  );
  if (!saved.ok) return { error: saved.error };
  return done("preferences", "preferences", path);
}

export async function stopWatchingThread(threadId: number) {
  if (!isRecordId(threadId)) {
    return pressInvalid("/account/preferences", "threads");
  }
  await press("/account/preferences", "threads", "threadUnwatched", () =>
    call(threadsUnwatch, { threadId }),
  );
}

export async function stopWatchingForum(nodeId: number) {
  if (!isRecordId(nodeId)) {
    return pressInvalid("/account/preferences", "forums");
  }
  await press("/account/preferences", "forums", "forumUnwatched", () =>
    call(nodesUnwatch, { nodeId }),
  );
}
