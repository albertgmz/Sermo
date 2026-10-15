import { usersConsent } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { Section } from "@/components/staff/rows";
import { call } from "@/lib/sermo/client";
import { ifAllowed } from "../data";

// The member's saved cookie choice, read only: the categories they accepted, the policy version
// they answered and when. Staff who may see the member's details may show it to a regulator. Left
// out when the viewer is refused the read.
export async function ConsentSection({ userId }: { userId: number }) {
  const [t, categories, answer] = await Promise.all([
    getTranslations("adminUsers.identity.consent"),
    getTranslations("cookies.banner.categories"),
    ifAllowed(() => call(usersConsent, { userId })),
  ]);
  if (answer === null) return null;
  const { record } = answer;
  return (
    <Section heading={t("heading")}>
      <div className="grid gap-1 p-4 text-sm">
        {record === null ? (
          <p className="text-muted-foreground">{t("none")}</p>
        ) : (
          <>
            <p>
              {record.categories.length === 0
                ? t("refusedAll")
                : t("accepted", {
                    categories: record.categories
                      .map((category) => categories(`${category}.title`))
                      .join(", "),
                  })}
            </p>
            <p className="text-muted-foreground">
              {t("record", {
                version: record.policyVersion,
                date: new Date(record.decidedAt),
              })}
            </p>
          </>
        )}
      </div>
    </Section>
  );
}
