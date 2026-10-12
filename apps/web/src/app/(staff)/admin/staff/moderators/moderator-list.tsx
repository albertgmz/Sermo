import { staffModerators } from "@sermo/core/contracts";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { read } from "@/lib/sermo/client";
import { cn } from "@/lib/utils";

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

// Who moderates what: each member holding a moderation permission, everywhere or in the listed
// forums, with links to their permissions and to the permissions of each forum.
export async function ModeratorList() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminGroups.moderators"),
    read(staffModerators, {}),
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
            <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
              {item.everywhere && (
                <Badge variant="success">{t("everywhere")}</Badge>
              )}
              {item.nodes.map((node) => (
                <Link
                  key={node.id}
                  href={`/admin/permissions/forums?node=${node.id}`}
                  className="inline-flex min-h-10 items-center rounded-lg border px-3 text-sm [overflow-wrap:anywhere] hover:bg-muted"
                >
                  {node.title}
                </Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
