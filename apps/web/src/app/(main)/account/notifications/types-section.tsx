import {
  notificationsPreferences,
  notificationsTypes,
  pushPublicKey,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { ActionForm } from "@/app/(main)/account/action-form";
import { saveNotifications } from "@/app/(main)/account/actions";
import {
  Notice,
  noticeOf,
  type SearchParams,
} from "@/app/(main)/account/notice";
import { Help, Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { read } from "@/lib/sermo/client";

const CHANNELS = ["inApp", "email", "push"] as const;
const columns = "grid grid-cols-[minmax(0,1fr)_repeat(3,3.5rem)] items-center";

export async function TypesSection({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [t, types, preferences, push, notice] = await Promise.all([
    getTranslations("account.notifications"),
    read(notificationsTypes, {}),
    read(notificationsPreferences, {}),
    read(pushPublicKey, {}),
    noticeOf(searchParams, ["notifications"]),
  ]);
  const chosen = new Map(preferences.items.map((entry) => [entry.type, entry]));
  const pushOff = push.publicKey === null;
  // A type the interface has no words for shows its id.
  const words = (id: string, part: "title" | "body") => {
    const key = `types.${id.replaceAll(".", "_")}.${part}`;
    return t.has(key as "heading") ? t(key as "heading") : id;
  };
  return (
    <Section
      id="types"
      heading={t("sectionHeading")}
      description={t("sectionDescription")}
    >
      <Notice notice={notice} />
      <ActionForm action={saveNotifications} submit={t("submit")}>
        <div
          className={`${columns} gap-x-1 px-4 py-2 text-xs font-medium text-muted-foreground`}
        >
          <span>{t("typeColumn")}</span>
          {CHANNELS.map((channel) => (
            <span key={channel} className="text-center">
              {t(`channels.${channel}`)}
            </span>
          ))}
        </div>
        {types.items.map((type) => {
          const now = chosen.get(type.id) ?? type.defaults;
          return (
            <div key={type.id} className={`${columns} gap-x-1 px-4 py-2`}>
              <div className="min-w-0 pr-2">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  {words(type.id, "title")}
                  {type.required && (
                    <Badge variant="secondary">{t("required")}</Badge>
                  )}
                </p>
                <Help>{words(type.id, "body")}</Help>
              </div>
              {CHANNELS.map((channel) =>
                type.channels.includes(channel) ? (
                  <div
                    key={channel}
                    className="flex min-h-10 items-center justify-center"
                  >
                    <Checkbox
                      name={`${type.id}:${channel}`}
                      defaultChecked={now[channel]}
                      disabled={
                        type.required || (channel === "push" && pushOff)
                      }
                      aria-label={t("cell", {
                        type: words(type.id, "title"),
                        channel: t(`channels.${channel}`),
                      })}
                    />
                  </div>
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
          );
        })}
        <div className="space-y-1 p-4">
          <Help>{t("defaultsHelp")}</Help>
          {pushOff && <Help>{t("pushOff")}</Help>}
        </div>
      </ActionForm>
    </Section>
  );
}
