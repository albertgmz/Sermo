import { awardsList } from "@sermo/core/contracts";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { AwardIcon } from "@/components/forum/award-icon";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Section } from "@/components/staff/rows";
import { RunNow } from "@/components/staff/run-now";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { deleteAward, runAwards } from "./actions";

// Every award in the order of the awards page (by category, easiest first; inactive ones too, for
// an administrator), each leading to its edit page; then the sweep. The backend does not page
// awards. Its tier is the colour of its icon.
export async function AwardList({
  searchParams,
  addAction,
}: {
  searchParams: PageProps<"/[locale]/admin/awards">["searchParams"];
  // The "Add award" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, format, locale, { items }] = await Promise.all([
    getTranslations("adminEconomy.awards"),
    getFormatter(),
    getLocale(),
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
            credits: formatCredits(award.credits, locale),
            holders: format.number(award.grantCount),
          }),
          badges: (
            <>
              <Badge variant="secondary">
                {award.category?.title ?? t("noCategory")}
              </Badge>
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
