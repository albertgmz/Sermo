import { authSignInHistory } from "@sermo/core/contracts";
import { getLocale, getTranslations } from "next-intl/server";
import { ClientIcons, clientLabel } from "@/components/forum/client-icons";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { Badge } from "@/components/ui/badge";
import { placeLabel } from "@/lib/location";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { getLogRetentionDays } from "@/lib/sermo/privacy";

// Without the answer the section says so; any other failure is not ours to hide.
async function askOrNull<T>(ask: () => Promise<T>): Promise<T | null> {
  try {
    return await ask();
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}

export async function SignInHistory() {
  const locale = await getLocale();
  const [t, icons, history, retention] = await Promise.all([
    getTranslations("account.security.history"),
    getTranslations("forum.clientIcons"),
    askOrNull(() => call(authSignInHistory, {})),
    getLogRetentionDays(),
  ]);
  return (
    <section id="history" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      {!history ? (
        <p role="alert" className="p-4 text-sm text-muted-foreground">
          {t("failedLoad")}
        </p>
      ) : history.items.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {history.items.map((entry) => (
            <li
              key={entry.id}
              className="flex min-h-14 items-center gap-3 px-4 py-2.5"
            >
              <ClientIcons client={entry.device} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                  {clientLabel(entry.device, icons)}
                  <Badge
                    variant={
                      entry.result === "success" ? "success" : "destructive"
                    }
                  >
                    {t(entry.result === "success" ? "success" : "failed")}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  <StaticRelativeTime date={entry.at} />
                  <span aria-hidden="true"> · </span>
                  {placeLabel(entry.location, locale) ?? t("unknownPlace")}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
      {retention !== null && (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          {t("retention", { days: retention })}
        </p>
      )}
    </section>
  );
}
