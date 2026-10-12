import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getGroups } from "../../groups/data";
import { ListSkeleton, PageHead } from "../../groups/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroups");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

async function Picker() {
  const [t, groups] = await Promise.all([
    getTranslations("adminGroups.permissionGroups"),
    getGroups(),
  ]);
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <ul aria-label={t("heading")} className="divide-y">
        {groups.map((group) => (
          <li key={group.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold [overflow-wrap:anywhere]">
                {group.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("rank", { rank: group.rank })}
              </p>
            </div>
            <Link
              href={`/admin/permissions/groups/${group.id}`}
              className={link}
            >
              {t("edit")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PermissionGroupsPage() {
  const t = useTranslations("adminGroups.permissionGroups");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton />
          </LoadingRegion>
        }
      >
        <Picker />
      </Suspense>
    </div>
  );
}
