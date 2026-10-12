import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseId } from "@/lib/sermo/ids";
import { cn } from "@/lib/utils";
import { groupsIfAllowed } from "../../groups/data";
import { ListSkeleton, PageHead } from "../../groups/skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionGroups");
  return { title: t("metaTitle") };
}

const link = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

async function Picker({
  searchParams,
}: {
  searchParams: PageProps<"/admin/permissions/groups">["searchParams"];
}) {
  const [t, groups, { id }] = await Promise.all([
    getTranslations("adminGroups.permissionGroups"),
    groupsIfAllowed(),
    searchParams,
  ]);
  // The fallback form below asks for a group by id.
  if (typeof id === "string") {
    const groupId = parseId(id.trim());
    if (groupId !== null) redirect(`/admin/permissions/groups/${groupId}`);
  }
  if (groups === null) {
    return (
      <section className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold">{t("heading")}</h2>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("noList")}
        </p>
        <form className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="group-id" className="text-sm font-medium">
              {t("groupId")}
            </label>
            <Input
              id="group-id"
              name="id"
              inputMode="numeric"
              required
              className="w-36"
            />
          </div>
          <button
            type="submit"
            className={cn(buttonVariants(), "min-h-10 px-4")}
          >
            {t("open")}
          </button>
        </form>
      </section>
    );
  }
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

export default function PermissionGroupsPage({
  searchParams,
}: PageProps<"/admin/permissions/groups">) {
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
        <Picker searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
