import { getTranslations } from "next-intl/server";
import { LOGGED_GROUPS } from "@/lib/consent/logged-data";
import { getLogRetentionDays } from "@/lib/sermo/privacy";

// What the server records, beside the cookies the policy page lists: shown on the cookie policy
// and under the privacy page, from the same group list and the backend's own retention age.
export async function LoggedData() {
  const [t, days] = await Promise.all([
    getTranslations("cookies.logged"),
    getLogRetentionDays(),
  ]);
  return (
    <section id="logged-data" className="mt-8">
      <h2 className="text-xl font-semibold tracking-tight">{t("heading")}</h2>
      <p className="mt-1 text-muted-foreground">{t("intro")}</p>
      <div className="mt-3 grid gap-3">
        {LOGGED_GROUPS.map((group) => (
          <div key={group} className="rounded-lg border p-4">
            <h3 className="font-semibold">{t(`items.${group}.title`)}</h3>
            <p className="mt-1 text-sm">{t(`items.${group}.text`)}</p>
          </div>
        ))}
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">{t("sessions.title")}</h3>
          <p className="mt-1 text-sm">{t("sessions.text")}</p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">{t("retention.title")}</h3>
          <p className="mt-1 text-sm">
            {days === null
              ? t("retention.unknown")
              : t("retention.text", { days })}
          </p>
        </div>
        <div className="rounded-lg border p-4">
          <h3 className="font-semibold">{t("access.title")}</h3>
          <p className="mt-1 text-sm">{t("access.text")}</p>
        </div>
      </div>
    </section>
  );
}
