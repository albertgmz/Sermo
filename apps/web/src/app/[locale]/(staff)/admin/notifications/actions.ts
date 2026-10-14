"use server";

import { notificationsTypes, settingsGet } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { invalidArgument } from "@/lib/sermo/outcome";
import { text, whole } from "../groups/form-errors";
import { saveSettings } from "../settings/save";
import { CHANNELS, SHOWN_TYPES } from "./grid";

// Sends `notificationDefaults` (a map the backend replaces, so the whole of it) and the retention.
// The map starts from a fresh read; only the types the form says it showed (`types`, one hidden
// field each) and whose cells the administrator changed are written into it, every other entry is
// sent back as it was: a type the backend added after the page was built keeps its stored value.
// A type is read as "off" in a channel only when the form showed it; a request without the marker
// is refused. A type the backend marks as required has no cell in the form and is left alone, and
// so is the email of a type that follows each watch (its cell is fixed): that channel keeps the
// stored value.
export async function saveNotificationDefaults(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  const shown = new Set(
    formData
      .getAll(SHOWN_TYPES)
      .filter((value): value is string => typeof value === "string"),
  );
  if (shown.size === 0) return { error: await invalidArgument() };
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
    if (type.required || !shown.has(type.id)) continue;
    const next = { ...type.defaults };
    const changed = [];
    for (const channel of CHANNELS) {
      if (!type.channels.includes(channel)) continue;
      if (channel === "email" && type.emailFollowsWatch) {
        next.email = current.notificationDefaults[type.id]?.email ?? next.email;
        continue;
      }
      next[channel] = formData.get(`${type.id}:${channel}`) === "on";
      if (next[channel] !== type.defaults[channel]) changed.push(channel);
    }
    if (changed.length > 0) {
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
