import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { PageList } from "./page-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pages");
  return { title: t("metaTitle") };
}

export default function PagesPage({
  searchParams,
}: PageProps<"/[locale]/admin/pages">) {
  const t = useTranslations("adminContent.pages");
  const add = (
    <Link
      href="/admin/pages/new"
      className={cn(buttonVariants(), "h-10 px-4 md:h-8 md:px-3")}
    >
      <Plus aria-hidden="true" />
      {t("header.add")}
    </Link>
  );
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/pages")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <PageList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
