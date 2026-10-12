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
  threadsUnwatch,
  usersChangeUsername,
  usersUnignore,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/app/(main)/account/action-form";
import { call } from "@/lib/sermo/client";
import { attempt } from "@/lib/sermo/outcome";
import { upload } from "@/lib/sermo/upload";

const ACCOUNT = "/account";

// A mutation that worked: the pages that show the member are read again and the page the form
// was on opens at the section with a notice.
function done(notice: string, hash: string, path = ACCOUNT): never {
  revalidatePath("/", "layout");
  redirect(`${path}?notice=${notice}#${hash}`);
}

// For the buttons that have no form state: a refusal comes back as a notice.
async function press(
  path: string,
  hash: string,
  notice: string,
  run: () => Promise<unknown>,
): Promise<never> {
  const result = await attempt(path, run);
  if (!result.ok) redirect(`${path}?notice=failed#${hash}`);
  return done(notice, hash, path);
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

// Pictures -------------------------------------------------------------------------------------

export async function uploadPicture(
  kind: "avatar" | "cover",
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    const t = await getTranslations("account.errors");
    return { error: t("noFile") };
  }
  const saved = await attempt(ACCOUNT, async () => {
    const fileId = await upload(kind, file);
    await call(kind === "avatar" ? imagesSetAvatar : imagesSetCover, {
      fileId,
    });
  });
  if (!saved.ok) return { error: saved.error };
  return done(kind, kind);
}

export async function removePicture(kind: "avatar" | "cover") {
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

export async function saveAbout(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const clearBirthday = formData.get("clear") === "birthday";
  const hasBirthday =
    text(formData, "day") !== "" || text(formData, "month") !== "";
  const year = text(formData, "year");
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
      ...(clearBirthday
        ? { birthday: null }
        : hasBirthday
          ? {
              birthday: {
                day: Number(text(formData, "day")),
                month: Number(text(formData, "month")),
                ...(year ? { year: Number(year) } : {}),
              },
            }
          : {}),
    }),
  );
  if (!saved.ok) return { error: saved.error };
  return done("about", "about");
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
  const raw = text(formData, "value");
  const saved = await attempt("/account/appearance", () =>
    call(appearanceSet, { [WORN[field]]: raw === "" ? null : Number(raw) }),
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
    const [{ items: types }, { items: current }] = await Promise.all([
      call(notificationsTypes, {}),
      call(notificationsPreferences, {}),
    ]);
    const now = new Map(current.map((entry) => [entry.type, entry]));
    const items = types.flatMap((type) => {
      if (type.required) return [];
      const change: Record<string, boolean> = {};
      for (const channel of CHANNELS) {
        if (!type.channels.includes(channel)) continue;
        const wanted = formData.get(`${type.id}:${channel}`) === "on";
        if (wanted !== (now.get(type.id)?.[channel] ?? false))
          change[channel] = wanted;
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
  await press("/account/preferences", "threads", "unwatched", () =>
    call(threadsUnwatch, { threadId }),
  );
}

export async function stopWatchingForum(nodeId: number) {
  await press("/account/preferences", "forums", "unwatched", () =>
    call(nodesUnwatch, { nodeId }),
  );
}
