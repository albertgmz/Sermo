import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { KeyPanel } from "@/app/[locale]/(main)/account/api/key-panel";
import { Section } from "@/components/staff/rows";
import { formatDate } from "@/lib/format";
import { listApiKeys } from "@/lib/sermo/auth";

// The member's key (or the keys made before the one-key rule), read from Better Auth per request.
export async function KeySection() {
  const [t, locale, listing] = await Promise.all([
    getTranslations("account.apiKeys.key"),
    getLocale(),
    listApiKeys(),
  ]);
  if (listing.code === "UNAUTHORIZED") redirect("/login");
  return (
    <Section id="key" heading={t("heading")} description={t("description")}>
      {listing.ok ? (
        <KeyPanel
          keys={listing.keys.map((key) => ({
            ...key,
            created: formatDate(key.createdAt, locale),
          }))}
        />
      ) : (
        <p role="alert" className="p-4 text-sm text-muted-foreground">
          {t("failed")}
        </p>
      )}
    </Section>
  );
}
