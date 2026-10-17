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
import { NoticeList } from "./notice-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notices");
  return { title: t("metaTitle") };
}

export default function NoticesPage({
  searchParams,
}: PageProps<"/[locale]/admin/notices">) {
  const t = useTranslations("adminCommunication.notices");
  const add = (
    <Link
      href="/admin/notices/new"
      className={cn(buttonVariants(), "h-10 px-4 md:h-8 md:px-3")}
    >
      <Plus aria-hidden="true" />
      {t("header.add")}
    </Link>
  );
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/notices")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={5} />}
    >
      <NoticeList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
