import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { KeyPanel } from "@/app/[locale]/(main)/account/api/key-panel";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { Section } from "@/components/staff/rows";
import { listApiKeys } from "@/lib/sermo/auth";

// The member's key (or the keys made before the one-key rule), read from Better Auth per request.
export async function KeySection() {
  const [t, listing] = await Promise.all([
    getTranslations("account.apiKeys.key"),
    listApiKeys(),
  ]);
  if (listing.code === "UNAUTHORIZED") redirect("/login");
  return (
    <Section id="key" heading={t("heading")} description={t("description")}>
      {listing.ok ? (
        <KeyPanel
          keys={listing.keys.map((key) => ({
            id: key.id,
            name: key.name,
            created: <StaticRelativeTime date={key.createdAt} />,
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
