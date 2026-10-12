import { creditRulesList, nodesList } from "@sermo/core/contracts";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { EconomyNotice, one } from "../credits/shared";
import { ConfirmDelete } from "../groups/confirm-delete";
import { deleteRule } from "./actions";
import { RuleForm } from "./rule-form";

type Search = PageProps<"/admin/credit-rules">["searchParams"];

// Every rule with its editor behind "Edit" (the address carries which), then the form for a new
// one. The backend does not page rules.
export async function RuleList({ searchParams }: { searchParams: Search }) {
  const [t, format, { items }, tree, params] = await Promise.all([
    getTranslations("adminEconomy.rules"),
    getFormatter(),
    read(creditRulesList, {}),
    read(nodesList, {}),
    searchParams,
  ]);
  const editing = parseId(one(params.edit));
  // A rule can be restricted to forums, not to categories.
  const nodes = tree.items
    .filter((node) => node.type === "forum")
    .map(({ id, title, depth }) => ({ id, title, depth }));
  const titleOf = new Map(nodes.map((node) => [node.id, node.title]));
  return (
    <>
      <EconomyNotice
        searchParams={searchParams}
        shown={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          deleted: t("notices.deleted"),
        }}
      />
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
          <p className="text-xs text-muted-foreground">{t("fromNow")}</p>
        </div>
        {items.length > 0 ? (
          <ul aria-label={t("heading")} className="divide-y">
            {items.map((rule) => (
              <li key={rule.id} id={`rule-${rule.id}`} className="scroll-mt-4">
                <div className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
                      {rule.title}
                      {rule.isActive ? (
                        <Badge variant="success">{t("active")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("inactive")}</Badge>
                      )}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`triggers.${rule.trigger}`)}
                      {" · "}
                      <strong
                        className={
                          rule.amount < 0 ? "text-destructive" : "text-success"
                        }
                      >
                        {format.number(rule.amount, { signDisplay: "always" })}
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
                    </span>
                  </span>
                  <Link
                    href={
                      editing === rule.id
                        ? "/admin/credit-rules"
                        : `/admin/credit-rules?edit=${rule.id}#rule-${rule.id}`
                    }
                    scroll={false}
                    className="inline-flex min-h-10 min-w-10 items-center justify-center text-sm font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {editing === rule.id ? t("close") : t("edit")}
                  </Link>
                </div>
                {editing === rule.id && (
                  <div className="space-y-4 border-t p-4">
                    <RuleForm rule={rule} nodes={nodes} />
                    <ConfirmDelete
                      action={deleteRule}
                      id={rule.id}
                      summary={t("deleteHeading")}
                      warning={t("deleteWarning")}
                      submit={t("delete")}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
      </section>
      <RuleForm nodes={nodes} />
    </>
  );
}
