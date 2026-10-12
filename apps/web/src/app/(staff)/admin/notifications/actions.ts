"use server";

import { notificationsTypes, settingsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { text, whole } from "../groups/form-errors";
import { saveSettings } from "../settings/save";

const CHANNELS = ["inApp", "email", "push"] as const;

// Sends `notificationDefaults` (a map the backend replaces, so the whole of it) and the retention.
// The map starts from a fresh read; only the types whose cells the form shows and the
// administrator changed are written into it, every other entry is sent back as it was. A type the
// backend marks as required has no cell in the form and is left alone.
export async function saveNotificationDefaults(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  const retention = whole(text(formData, "notificationRetentionDays"));
  if (retention === null) {
    return { fields: { notificationRetentionDays: t("number") } };
  }
  const [types, current] = await Promise.all([
    call(notificationsTypes, {}),
    call(settingsGet, {}),
  ]);
  const defaults = { ...current.notificationDefaults };
  for (const type of types.items) {
    if (type.required) continue;
    const next = { ...type.defaults };
    for (const channel of CHANNELS) {
      if (!type.channels.includes(channel)) continue;
      next[channel] = formData.get(`${type.id}:${channel}`) === "on";
    }
    if (CHANNELS.some((channel) => next[channel] !== type.defaults[channel])) {
      defaults[type.id] = next;
    }
  }
  return saveSettings(
    {
      body: {
        notificationDefaults: defaults,
        notificationRetentionDays: retention,
      },
      fields: {},
    },
    {
      back: "/admin/notifications",
      known: (name) => name === "notificationRetentionDays",
    },
  );
}
