import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ForumList } from "@/app/[locale]/(main)/forums/forum-list";
import {
  STATS_TABS,
  type StatsTab,
} from "@/app/[locale]/(main)/forums/forum-stats";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("forums.forums");
  return { title: t("metaTitle") };
}

function forumsHref(tab: string | null, stats: StatsTab) {
  const params = new URLSearchParams();
  if (tab !== null) params.set("tab", tab);
  if (stats !== STATS_TABS[0].value) params.set("stats", stats);
  const query = params.toString();
  return query ? `/forums?${query}` : "/forums";
}

async function GuestHero() {
  const t = await getTranslations("forums.forums");
  return (
    <PageHero title={t("heading")} subtitle={t("description")}>
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
      >
        {t("login")}
      </Link>
      <Link href="/register" className={cn(buttonVariants(), "h-10 px-4")}>
        {t("register")}
      </Link>
    </PageHero>
  );
}

export default async function ForumsPage({
  searchParams,
}: PageProps<"/[locale]/forums">) {
  const { tab, stats: statsParam } = await searchParams;
  const stats: StatsTab =
    STATS_TABS.find((entry) => entry.value === statsParam)?.value ??
    STATS_TABS[0].value;
  const selected = typeof tab === "string" ? tab : null;
  const { user } = await getViewer();

  return (
    <>
      {!user && <GuestHero />}
      <PageLayout
        className={user ? undefined : "pt-2"}
        mainClassName="space-y-(--page-gap)"
      >
        <ForumList section={selected} stats={stats} hrefFor={forumsHref} />
      </PageLayout>
    </>
  );
}
