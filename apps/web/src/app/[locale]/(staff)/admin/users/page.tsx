import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
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
        <Link
          href="/admin/users/batch"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 px-4",
          )}
        >
          {t("batchLink")}
        </Link>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={8} />}
    >
      <UserList searchParams={searchParams} />
    </ScreenFrame>
  );
}
