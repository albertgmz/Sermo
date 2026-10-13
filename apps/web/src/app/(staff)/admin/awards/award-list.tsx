import { awardsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { AwardIcon } from "@/components/forum/award-icon";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { EconomyNotice } from "../credits/shared";
import { runAwards } from "./actions";
import { AwardForm } from "./award-form";

// Every award, best tier first as the backend orders them (inactive ones too, for an
// administrator), each linking to its editor; then the sweep and the form for a new award. The
// backend does not page awards.
export async function AwardList({
  searchParams,
}: {
  searchParams: PageProps<"/admin/awards">["searchParams"];
}) {
  const [t, format, { items }] = await Promise.all([
    getTranslations("adminEconomy.awards"),
    getFormatter(),
    read(awardsList, {}),
  ]);
  return (
    <>
      <EconomyNotice
        searchParams={searchParams}
        shown={{
          created: t("notices.created"),
          deleted: t("notices.deleted"),
        }}
      />
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
          <p className="text-xs text-muted-foreground">{t("description")}</p>
        </div>
        {items.length > 0 ? (
          <ul aria-label={t("heading")} className="divide-y">
            {items.map((award) => (
              <li
                key={award.id}
                className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3"
              >
                <AwardIcon award={award} size="lg" />
                <span className="min-w-0 flex-1 space-y-1">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
                    {award.name}
                    <Badge variant="secondary">
                      {t(`tiers.${award.tier}`)}
                    </Badge>
                    {award.isActive ? (
                      <Badge variant="success">{t("active")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                    {award.criteria.length > 0 && (
                      <Badge variant="outline">{t("automatic")}</Badge>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("facts", {
                      xp: format.number(award.xp),
                      credits: format.number(award.credits),
                      holders: format.number(award.grantCount),
                    })}
                  </span>
                </span>
                <Link
                  href={`/admin/awards/${award.id}`}
                  className="inline-flex min-h-10 min-w-10 items-center justify-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {t("edit")}
                  <span className="sr-only"> {award.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
      </section>
      <Section heading={t("runHeading")} description={t("runHelp")}>
        <div className="p-4">
          <RunNow action={runAwards} namespace="adminEconomy.awards" />
        </div>
      </Section>
      <AwardForm />
    </>
  );
}
