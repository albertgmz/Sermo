import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { PrefixList } from "./prefix-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixes");
  return { title: t("metaTitle") };
}

export default function PrefixesPage({
  searchParams,
}: PageProps<"/[locale]/admin/forums/prefixes">) {
  const t = useTranslations("adminForums.prefixes");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/forums/prefixes")}
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      actions={
        <Link
          href="/admin/forums/prefixes/new"
          className={cn(buttonVariants(), "min-h-10 px-4")}
        >
          {t("add")}
        </Link>
      }
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <PrefixList searchParams={searchParams} />
    </ScreenFrame>
  );
}
