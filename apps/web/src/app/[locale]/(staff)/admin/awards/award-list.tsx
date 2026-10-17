import { awardsList } from "@sermo/core/contracts";
import { getFormatter, getTranslations } from "next-intl/server";
import { AwardIcon } from "@/components/forum/award-icon";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { deleteAward, runAwards } from "./actions";

// Every award, best tier first as the backend orders them (inactive ones too, for an
// administrator), each leading to its edit page; then the sweep. The backend does not page awards.
export async function AwardList({
  searchParams,
  addAction,
}: {
  searchParams: PageProps<"/[locale]/admin/awards">["searchParams"];
  // The "Add award" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, format, { items }] = await Promise.all([
    getTranslations("adminEconomy.awards"),
    getFormatter(),
    read(awardsList, {}),
  ]);
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          deleted: t("notices.deleted"),
        }}
      />
      <ItemList
        label={t("heading")}
        heading={t("heading")}
        description={t("description")}
        empty={{
          title: t("none"),
          description: t("emptyDescription"),
          action: addAction,
        }}
        items={items.map((award) => ({
          id: award.id,
          icon: <AwardIcon award={award} size="md" />,
          title: award.name,
          href: `/admin/awards/${award.id}`,
          description: t("facts", {
            xp: format.number(award.xp),
            credits: format.number(award.credits),
            holders: format.number(award.grantCount),
          }),
          badges: (
            <>
              <Badge variant="secondary">{t(`tiers.${award.tier}`)}</Badge>
              {award.isActive ? (
                <Badge variant="success">{t("active")}</Badge>
              ) : (
                <Badge variant="outline">{t("inactive")}</Badge>
              )}
              {award.rule.conditions.length > 0 && (
                <Badge variant="outline">{t("automatic")}</Badge>
              )}
            </>
          ),
          actions: (
            <>
              <RowLink
                href={`/admin/awards/${award.id}`}
                label={t("edit", { name: award.name })}
              />
              <ConfirmStep
                action={deleteAward}
                fields={{ id: award.id }}
                summary={t("deleteShort")}
                submit={t("delete")}
                warning={t("deleteWarning")}
              />
            </>
          ),
        }))}
      />
      <Section heading={t("runHeading")} description={t("runHelp")}>
        <div className="p-4">
          <RunNow action={runAwards} namespace="adminEconomy.awards" />
        </div>
      </Section>
    </>
  );
}
