import { promotionsCriteria, promotionsList } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { RunNow } from "@/components/staff/run-now";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";
import { hrefFor } from "../../registry";
import { getGroups, groupLabel } from "../groups/data";
import { runPromotions } from "./actions";
import { PromotionForm } from "./promotion-form";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// Every promotion rule, the control to run them now, and the form for a new rule.
export async function PromotionList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
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
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
          <a href="#new" className={link}>
            {t("new")}
          </a>
        </div>
        {items.length > 0 ? (
          <ul aria-label={t("heading")} className="divide-y">
            {items.map((promotion) => (
              <li
                key={promotion.id}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold [overflow-wrap:anywhere]">
                      {promotion.title}
                    </span>
                    <Badge
                      variant={promotion.isActive ? "success" : "secondary"}
                    >
                      {promotion.isActive ? t("active") : t("inactive")}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {promotion.criteria
                      .map(
                        (entry) =>
                          `${names.get(entry.criterion) ?? entry.criterion}: ${entry.value}`,
                      )
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
                </div>
                <Link
                  href={`/admin/promotions/${promotion.id}`}
                  className={link}
                >
                  {t("edit")}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("empty")}</p>
        )}
      </section>
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <div>
          <h2 className="text-sm font-semibold">{t("runHeading")}</h2>
          <p className="text-xs text-muted-foreground">{t("runDescription")}</p>
        </div>
        <RunNow action={runPromotions} namespace="adminGroups.promotions" />
        {log && (
          <Link
            href={log}
            className="inline-flex min-h-10 items-center text-sm text-primary underline-offset-4 hover:underline"
          >
            {t("log")}
          </Link>
        )}
      </section>
      <PromotionForm />
    </>
  );
}
