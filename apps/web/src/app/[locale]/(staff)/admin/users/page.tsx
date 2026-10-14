import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../groups/skeletons";
import { UserList } from "./user-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.list");
  return { title: t("metaTitle") };
}

export default function UsersPage({
  searchParams,
}: PageProps<"/[locale]/admin/users">) {
  const t = useTranslations("adminUsers.list");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={8} />
          </LoadingRegion>
        }
      >
        <UserList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
