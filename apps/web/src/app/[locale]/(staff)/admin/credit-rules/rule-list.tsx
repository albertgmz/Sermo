import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { formatCredits } from "@/lib/format";
import { parseId } from "@/lib/sermo/ids";
import { one } from "../credits/shared";
import { deleteRule } from "./actions";
import { ruleData } from "./rule-data";

type Search = {
  notice?: string | string[];
  edit?: string | string[];
};

// Every rule: its title leading to its edit page, an active badge, and a line with the event, the
// credits, the limit and the forums. The address the editor used to open at (`?edit=<id>`) goes to
// the rule's own page. The backend does not page rules.
export async function RuleList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<Search>;
  // The "Add rule" link, offered again when the list is empty.
  addAction: React.ReactNode;
}) {
  const [t, locale, { items, nodes }, params] = await Promise.all([
    getTranslations("adminEconomy.rules"),
    getLocale(),
    ruleData(),
    searchParams,
  ]);
  const editing = parseId(one(params.edit));
  if (editing !== null && items.some((rule) => rule.id === editing)) {
    redirect(`/admin/credit-rules/${editing}`);
  }
  const titleOf = new Map(nodes.map((node) => [node.id, node.title]));
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          deleted: t("notices.deleted"),
        }}
      />
      <ItemList
        label={t("heading")}
        heading={t("heading")}
        description={t("fromNow")}
        empty={{
          title: t("none"),
          description: t("emptyDescription"),
          action: addAction,
        }}
        items={items.map((rule) => ({
          id: rule.id,
          title: rule.title,
          href: `/admin/credit-rules/${rule.id}`,
          description: (
            <>
              {t(`triggers.${rule.trigger}`)}
              {" · "}
              <strong
                className={
                  rule.amount < 0 ? "text-destructive" : "text-success"
                }
              >
                {formatCredits(rule.amount, locale, { signed: true })}
              </strong>
              {" · "}
              {rule.limit
                ? t("limitValue", {
                    count: rule.limit.count,
                    hours: rule.limit.windowHours,
                  })
                : t("noLimit")}
              {" · "}
              {rule.nodeIds.length > 0
                ? t("forumsValue", {
                    names: rule.nodeIds
                      .map((id) => titleOf.get(id) ?? `#${id}`)
                      .join(", "),
                  })
                : t("everywhere")}
            </>
          ),
          badges: rule.isActive ? (
            <Badge variant="success">{t("active")}</Badge>
          ) : (
            <Badge variant="outline">{t("inactive")}</Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`/admin/credit-rules/${rule.id}`}
                label={t("edit", { title: rule.title })}
              />
              <ConfirmStep
                action={deleteRule}
                fields={{ id: rule.id }}
                summary={t("deleteShort")}
                submit={t("delete")}
                warning={t("deleteWarning")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}
