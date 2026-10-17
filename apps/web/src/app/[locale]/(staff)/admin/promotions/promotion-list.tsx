import { promotionsCriteria, promotionsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { RunNow } from "@/components/staff/run-now";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { hrefFor } from "../../registry";
import { getGroups, groupLabel } from "../groups/data";
import { runPromotions } from "./actions";

// Every promotion rule, each leading to its edit page, and the control to run them now.
export async function PromotionList({
  searchParams,
  addAction,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
  addAction: React.ReactNode;
}) {
  const [t, viewer, { items }, { items: criteria }, groups] = await Promise.all(
    [
      getTranslations("adminGroups.promotions"),
      getViewer(),
      read(promotionsList, {}),
      read(promotionsCriteria, {}),
      getGroups(),
    ],
  );
  const log = hrefFor(viewer, "toolsPromotionLog");
  const names = new Map(criteria.map((entry) => [entry.id, entry.title]));
  return (
    <>
      <Notice
        namespace="adminGroups.notices"
        searchParams={searchParams}
        shown={["deleted"]}
      />
      <ItemList
        label={t("heading")}
        empty={{
          title: t("empty"),
          action: addAction,
        }}
        items={items.map((promotion) => ({
          id: promotion.id,
          title: promotion.title,
          href: `/admin/promotions/${promotion.id}`,
          badges: (
            <Badge variant={promotion.isActive ? "success" : "secondary"}>
              {promotion.isActive ? t("active") : t("inactive")}
            </Badge>
          ),
          description: (
            <>
              <p>
                {promotion.rule.conditions
                  .map(
                    (entry) =>
                      `${names.get(entry.criterion) ?? entry.criterion}: ${entry.ids?.join(", ") ?? entry.value}`,
                  )
                  .join(promotion.rule.match === "any" ? " / " : " · ")}
              </p>
              <p>
                {t("grants")}{" "}
                <span className="font-medium text-foreground">
                  {promotion.groupIds
                    .map((id) =>
                      groupLabel(groups, id, (n) =>
                        t("groupNumber", { id: n }),
                      ),
                    )
                    .join(", ")}
                </span>
              </p>
            </>
          ),
          actions: (
            <RowLink
              href={`/admin/promotions/${promotion.id}`}
              label={t("edit", { title: promotion.title })}
            />
          ),
        }))}
      />
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("runHeading")}</h2>
          <p className="text-xs text-muted-foreground">{t("runDescription")}</p>
        </div>
        <RunNow action={runPromotions} namespace="adminGroups.promotions" />
        {log && (
          <Link
            href={log}
            className="inline-flex min-h-10 items-center text-sm text-primary-ink underline-offset-4 hover:underline"
          >
            {t("log")}
          </Link>
        )}
      </section>
    </>
  );
}
