import { notificationsTypes } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Help } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { getSettings } from "../settings/data";
import { saveNotificationDefaults } from "./actions";
import { CHANNELS, SHOWN_TYPES } from "./grid";

const columns = "grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center";

// The site's default for each notification type and channel, as the backend returns them (its own
// registry defaults with the administrator's on top). The type words are the member's own
// preferences page's.
export async function DefaultsForm() {
  const [t, words, types, settings] = await Promise.all([
    getTranslations("adminCommunication.notifications"),
    getTranslations("account.notifications"),
    read(notificationsTypes, {}),
    getSettings(),
  ]);
  const label = (id: string, part: "title" | "body") => {
    const key = `types.${id.replaceAll(".", "_")}.${part}`;
    return words.has(key as "heading") ? words(key as "heading") : id;
  };
  return (
    <FormRows
      action={saveNotificationDefaults}
      heading={t("heading")}
      description={t("description")}
    >
      <div>
        <div
          className={`${columns} gap-x-1 px-4 py-2 text-xs font-medium text-muted-foreground`}
        >
          <span>{words("typeColumn")}</span>
          {CHANNELS.map((channel) => (
            <span key={channel} className="text-center">
              {words(`channels.${channel}`)}
            </span>
          ))}
        </div>
        {types.items.map((type) => (
          <div key={type.id} className={`${columns} gap-x-1 px-4 py-2`}>
            <div className="min-w-0 pr-2">
              {!type.required && (
                <input type="hidden" name={SHOWN_TYPES} value={type.id} />
              )}
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                {label(type.id, "title")}
                {type.required && (
                  <Badge variant="secondary">{t("fixed")}</Badge>
                )}
              </p>
              <Help>{label(type.id, "body")}</Help>
              {type.emailFollowsWatch && type.channels.includes("email") && (
                <Help>{t("followsWatch")}</Help>
              )}
            </div>
            {CHANNELS.map((channel) =>
              type.channels.includes(channel) ? (
                // biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is a Base UI root, which an enclosing label names
                <label
                  key={channel}
                  className="relative flex min-h-10 items-center justify-center"
                >
                  <Checkbox
                    name={`${type.id}:${channel}`}
                    defaultChecked={type.defaults[channel]}
                    disabled={
                      type.required ||
                      (channel === "email" && type.emailFollowsWatch)
                    }
                  />
                  <span className="sr-only">
                    {words("cell", {
                      type: label(type.id, "title"),
                      channel: words(`channels.${channel}`).toLowerCase(),
                    })}
                  </span>
                </label>
              ) : (
                <span
                  key={channel}
                  aria-hidden="true"
                  className="text-center text-muted-foreground"
                >
                  –
                </span>
              ),
            )}
          </div>
        ))}
        <div className="p-4">
          <Help>{t("help")}</Help>
        </div>
      </div>
      <FieldRow
        name="notificationRetentionDays"
        label={t("retention.label")}
        htmlFor="field-notificationRetentionDays"
        help={t("retention.help")}
      >
        <div className="flex items-center gap-2">
          <Input
            id="field-notificationRetentionDays"
            name="notificationRetentionDays"
            type="number"
            inputMode="numeric"
            required
            defaultValue={settings.notificationRetentionDays}
            aria-describedby="field-notificationRetentionDays-help"
          />
          <span className="shrink-0 text-sm text-muted-foreground">
            {t("retention.unit")}
          </span>
        </div>
      </FieldRow>
    </FormRows>
  );
}
