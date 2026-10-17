import { ArrowUpDown, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { ReactionList } from "./reaction-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.reactions");
  return { title: t("metaTitle") };
}

const BUTTON = "h-10 px-4 md:h-8 md:px-3";

export default function ReactionsPage({
  searchParams,
}: PageProps<"/[locale]/admin/reactions">) {
  const t = useTranslations("adminContent.reactions");
  const add = (
    <Link href="/admin/reactions/new" className={cn(buttonVariants(), BUTTON)}>
      <Plus aria-hidden="true" />
      {t("header.add")}
    </Link>
  );
  return (
    <ScreenFrame
      heading={t("heading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/reactions")}
      actions={
        <>
          <Link
            href="/admin/reactions/sort"
            className={cn(buttonVariants({ variant: "outline" }), BUTTON)}
          >
            <ArrowUpDown aria-hidden="true" />
            {t("header.sort")}
          </Link>
          {add}
        </>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <ReactionList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
