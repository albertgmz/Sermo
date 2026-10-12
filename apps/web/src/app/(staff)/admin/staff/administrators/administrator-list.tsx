import { staffAdministrators } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";
import { getDefinitions } from "../../permissions/data";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// Every member holding an administration permission, with the ones they hold.
export async function AdministratorList() {
  const [t, definitions, { items }] = await Promise.all([
    getTranslations("adminGroups.administrators"),
    getDefinitions(),
    read(staffAdministrators, {}),
  ]);
  if (items.length === 0) {
    return (
      <section className="rounded-lg border bg-card">
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </section>
    );
  }
  const titles = new Map(
    definitions.map((definition) => [definition.id, definition.title]),
  );
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
      </div>
      <ul aria-label={t("heading")} className="divide-y">
        {items.map((item) => (
          <li key={item.card.id}>
            <MemberRow user={item.card} className="flex-wrap py-3">
              <Link
                href={`/admin/permissions/members/${item.card.id}`}
                className={link}
              >
                {t("permissions")}
              </Link>
            </MemberRow>
            <ul
              aria-label={t("holds")}
              className="flex flex-wrap gap-1.5 px-4 pb-3"
            >
              {item.permissions.map((id) => (
                <li
                  key={id}
                  title={id}
                  className="rounded-sm border px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]"
                >
                  {titles.get(id) ?? id}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
