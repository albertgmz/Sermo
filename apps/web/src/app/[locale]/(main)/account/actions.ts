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
  usersUnblock,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { FormState } from "@/app/[locale]/(main)/account/action-form";
import { failedPath } from "@/app/[locale]/(main)/account/notice";
import { LOCALE_COOKIE } from "@/i18n/locale-cookie";
import { writeLocaleCookie } from "@/i18n/write-locale-cookie";
import type { SaveResult } from "@/lib/autosave";
import type { HomeTab } from "@/lib/home-tabs";
import { call } from "@/lib/sermo/client";
import { isRecordId, parseId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";
import { isPicturePurpose } from "@/lib/sermo/upload";

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

// The backend deletes the file when the picture is removed, so there is nothing to put back: the
// page asks the member to confirm before it calls this.
export async function removePicture(
  kind: "avatar" | "cover",
): Promise<SaveResult> {
  if (!isPicturePurpose(kind)) return { error: await invalidArgument() };
  const removed = await attempt(ACCOUNT, () =>
    call(kind === "avatar" ? imagesSetAvatar : imagesSetCover, {
      fileId: null,
    }),
  );
  if (!removed.ok) return { error: removed.error };
  revalidatePath("/", "layout");
  return { ok: true };
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

// Every row of the profile saves on its own, so this takes one part of it: the fields that row
// holds, as FormData. A birthday is the three fields together; a title or a signature that is
// emptied is cleared; the +18 mark is a switch.
const PROFILE_PARTS = [
  "about",
  "location",
  "website",
  "birthday",
  "discord",
  "telegram",
  "x",
  "customTitle",
  "signature",
  "isAdult",
] as const;

type ProfileChange = z.input<typeof profilesUpdate.input>;

export type ProfilePart = (typeof PROFILE_PARTS)[number];

function profileChange(
  part: ProfilePart,
  formData: FormData,
): ProfileChange | null {
  switch (part) {
    case "birthday":
      return birthdayOf(formData);
    case "discord":
    case "telegram":
    case "x":
      return { socials: { [part]: text(formData, part) } };
    case "customTitle":
    case "signature":
      return { [part]: text(formData, part).trim() || null };
    // A switch, sent with the row's marker whether it is on or off.
    case "isAdult":
      return { isAdult: formData.get("isAdult") !== null };
    default:
      return { [part]: text(formData, part) };
  }
}

export async function saveProfile(
  part: ProfilePart,
  formData: FormData,
): Promise<SaveResult> {
  if (!PROFILE_PARTS.includes(part)) return { error: await invalidArgument() };
  const change = profileChange(part, formData);
  if (!change) {
    const t = await getTranslations("account.errors");
    return { error: t("birthdayIncomplete") };
  }
  const saved = await attempt(ACCOUNT, () => call(profilesUpdate, change));
  if (!saved.ok) return { error: saved.error };
  // No page is read again: that redraws the page under the member while they type. The profile
  // page, the member card and the postbit read the profile on each visit, so the next one shows it.
  return { ok: true };
}

// The remove buttons of a title or a signature that is saved but not shown any more.
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
  nameIcon: "nameIconItemId",
  cover: "coverPresetId",
} as const;

export type AppearanceField = keyof typeof WORN;

// A choice saves as it is made: the page is read again and nothing redirects.
export async function saveAppearance(
  field: AppearanceField,
  formData: FormData,
): Promise<SaveResult> {
  if (!Object.hasOwn(WORN, field)) return { error: await invalidArgument() };
  const raw = text(formData, "value");
  const id = raw === "" ? null : parseId(raw);
  if (raw !== "" && id === null) return { error: await invalidArgument() };
  const saved = await attempt(ACCOUNT, () =>
    call(appearanceSet, { [WORN[field]]: id }),
  );
  if (!saved.ok) return { error: saved.error };
  revalidatePath("/", "layout");
  return { ok: true };
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
      // A checkbox: absent from the form when unticked.
      showOnline: formData.get("showOnline") === "on",
    }),
  );
  if (!saved.ok) return { error: saved.error };
  return done("privacy", "privacy", "/account/privacy");
}

export async function unblock(userId: number) {
  if (!isRecordId(userId)) return pressInvalid("/account/privacy", "blocked");
  await press("/account/privacy", "blocked", "unblocked", () =>
    call(usersUnblock, { userId }),
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
  const language = text(formData, "language") || null;
  const saved = await attempt(path, () =>
    call(preferencesUpdate, {
      watchOnCreate: text(formData, "watchOnCreate") as "none",
      watchOnReply: text(formData, "watchOnReply") as "none",
      language,
      keyboardShortcuts: formData.get("keyboardShortcuts") === "on",
      homeTab: (text(formData, "homeTab") || null) as HomeTab | null,
    }),
  );
  if (!saved.ok) return { error: saved.error };
  // The proxy picks the language of a page from this cookie, so the page the redirect opens is
  // already in the new one. "Default" removes it: the site's default decides again.
  const store = await cookies();
  if (language) writeLocaleCookie(store, language);
  else store.delete(LOCALE_COOKIE);
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
