import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { HeaderLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
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
    <ScreenFrame
      trail={staffTrail("/admin/users")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      actions={
        <HeaderLink href="/admin/users/batch">{t("batchLink")}</HeaderLink>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={8} />}
    >
      <UserList searchParams={searchParams} />
    </ScreenFrame>
  );
}
