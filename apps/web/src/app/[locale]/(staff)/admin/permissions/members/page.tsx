import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ListSkeleton, PageHead } from "../../groups/skeletons";
import { MemberPicker } from "../member-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.permissionMembers");
  return { title: t("metaTitle") };
}

async function Picker({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/permissions/members">["searchParams"];
}) {
  const [t, { q }] = await Promise.all([
    getTranslations("adminGroups.permissionMembers"),
    searchParams,
  ]);
  return (
    <MemberPicker
      query={typeof q === "string" ? q : undefined}
      heading={t("heading")}
      action={t("edit")}
      href={(id) => `/admin/permissions/members/${id}`}
    >
      {(member) => (
        <Link
          href={`/admin/permissions/explain?user=${member.id}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 px-4",
          )}
        >
          {t("analyse")}
        </Link>
      )}
    </MemberPicker>
  );
}

export default function PermissionMembersPage({
  searchParams,
}: PageProps<"/[locale]/admin/permissions/members">) {
  const t = useTranslations("adminGroups.permissionMembers");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={2} />
          </LoadingRegion>
        }
      >
        <Picker searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
