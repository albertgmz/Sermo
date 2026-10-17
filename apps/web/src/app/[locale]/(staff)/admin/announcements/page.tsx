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
import { AnnouncementList } from "./announcement-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.announcements");
  return { title: t("metaTitle") };
}

export default function AnnouncementsPage({
  searchParams,
}: PageProps<"/[locale]/admin/announcements">) {
  const t = useTranslations("adminCommunication.announcements");
  const add = (
    <Link
      href="/admin/announcements/new"
      className={cn(buttonVariants(), "h-10 px-4 md:h-8 md:px-3")}
    >
      <Plus aria-hidden="true" />
      {t("new")}
    </Link>
  );
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/announcements")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={5} />}
    >
      <AnnouncementList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
