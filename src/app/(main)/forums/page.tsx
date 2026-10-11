import { CircleDollarSign, MessageCircle, Store } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ForumSidebar } from "@/app/(main)/forums/forum-sidebar";
import {
  ForumStats,
  STATS_TABS,
  type StatsTab,
} from "@/app/(main)/forums/forum-stats";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { ForumCard } from "@/components/forum/forum-card";
import { TabLinks } from "@/components/forum/tab-links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { getCategories, getUsers, type UserView } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import type { ForumTab } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Forums - forum/ui",
};

const TABS = [
  {
    value: "general",
    label: "General",
    icon: <MessageCircle className="size-4" />,
  },
  {
    value: "market",
    label: "Market",
    icon: <Store className="size-4 text-primary" />,
  },
  {
    value: "money",
    label: "Money",
    icon: <CircleDollarSign className="size-4 text-primary" />,
  },
] as const;

function forumsHref(tab: ForumTab, stats: StatsTab) {
  const params = new URLSearchParams();
  if (tab !== TABS[0].value) params.set("tab", tab);
  if (stats !== STATS_TABS[0].value) params.set("stats", stats);
  const query = params.toString();
  return query ? `/forums?${query}` : "/forums";
}

function GuestHero({ users }: { users: UserView[] }) {
  return (
    <PageHero
      title="Ask questions. Share what you know."
      subtitle="Join a community of makers who trade ideas, feedback and good advice every day."
    >
      <div className="flex w-full justify-center -space-x-2 sm:w-auto">
        {users.map((user) => (
          <UserAvatar
            key={user.id}
            user={user}
            size="lg"
            link={false}
            className="ring-2 ring-primary"
          />
        ))}
      </div>
      <Link
        href="/login"
        className={cn(buttonVariants({ variant: "outline" }), "h-10 px-4")}
      >
        Log in
      </Link>
      <Link href="/register" className={cn(buttonVariants(), "h-10 px-4")}>
        Create Account
      </Link>
    </PageHero>
  );
}

export default async function ForumsPage({
  searchParams,
}: PageProps<"/forums">) {
  const { tab: param, stats: statsParam } = await searchParams;
  const tab: ForumTab =
    TABS.find((entry) => entry.value === param)?.value ?? TABS[0].value;
  const stats: StatsTab =
    STATS_TABS.find((entry) => entry.value === statsParam)?.value ??
    STATS_TABS[0].value;
  const [user, categories] = await Promise.all([
    getCurrentUser(),
    getCategories(tab),
  ]);
  const heroUsers = user ? [] : (await getUsers()).slice(0, 5);

  return (
    <>
      {!user && <GuestHero users={heroUsers} />}
      <PageLayout
        aside={<ForumSidebar viewer={user} />}
        className={user ? undefined : "pt-2"}
        mainClassName="space-y-(--page-gap)"
      >
        <ForumStats
          active={stats}
          hrefFor={(value) => forumsHref(tab, value)}
          viewerId={user?.id}
        />

        <TabLinks
          tabs={TABS.map((entry) => ({
            ...entry,
            href: forumsHref(entry.value, stats),
          }))}
          active={tab}
          label="Forum sections"
          variant="segmented"
        />

        {categories.map((category) => (
          <CollapsiblePanel
            key={category.id}
            title={category.title}
            storageKey={`forum-category-${category.id}-open`}
          >
            <ul className="grid gap-2 p-2 md:grid-cols-2">
              {category.forums.map((forum) => (
                <ForumCard
                  key={forum.id}
                  forum={forum}
                  className="md:last:odd:col-span-2"
                />
              ))}
            </ul>
          </CollapsiblePanel>
        ))}
      </PageLayout>
    </>
  );
}
