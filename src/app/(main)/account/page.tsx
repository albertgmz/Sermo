import {
  CalendarDays,
  ChevronsUpDown,
  Heart,
  MessageCircle,
  Star,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppearancePanel } from "@/app/(main)/account/appearance";
import { PermissionsPanel } from "@/app/(main)/account/permissions";
import { StatsChart } from "@/app/(main)/account/stats-chart";
import { logout } from "@/app/(main)/actions";
import { ClientIcons, clientLabel } from "@/components/forum/client-icons";
import { StatTile } from "@/components/forum/stat";
import { TabLinks } from "@/components/forum/tab-links";
import { UserAvatar } from "@/components/forum/user-avatar";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getClientInfo } from "@/lib/client";
import {
  getPermissions,
  getSessions,
  getShopItems,
  getUnlocks,
  getUserPosts,
} from "@/lib/db";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Account Dashboard - forum/ui",
};

const TABS = [
  "Overview",
  "Account",
  "Privacy",
  "Security",
  "Premium Perks",
  "Settings",
].map((label) => ({ value: label, label, href: "#" }));

const SETTINGS = [
  { label: "Account details", href: "#" },
  { label: "Password and security", href: "#devices" },
  { label: "Privacy", href: "#" },
  { label: "Preferences", href: "#appearance" },
  { label: "Permissions", href: "#permissions" },
  { label: "Signature", href: "#signature" },
  { label: "Connected accounts", href: "#" },
  { label: "Following", href: "#" },
  { label: "Ignoring", href: "#" },
];

type Props = {
  searchParams: Promise<{ saved?: string | string[] }>;
};

function SidebarGroup({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <section>
      <h2 className="flex h-12 items-center border-b px-4 text-sm font-semibold">
        {title}
      </h2>
      <ul className="py-2">
        {links.map(({ label, href }) => (
          <li key={label}>
            <Link
              href={href}
              className="flex h-10 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground lg:h-8"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AccountPage({ searchParams }: Props) {
  const [{ saved }, user] = await Promise.all([searchParams, getCurrentUser()]);
  if (!user) redirect("/login");
  const [allPosts, sessions, client, unlocks, shopItems, permissions] =
    await Promise.all([
      getUserPosts(user.id, user.id),
      getSessions(user.id),
      getClientInfo(),
      getUnlocks(user.id),
      getShopItems(),
      getPermissions(user.id),
    ]);
  const permissionPrices = Object.fromEntries(
    shopItems.flatMap(({ price, effect }) =>
      effect.type === "permission" ? [[effect.permission, price]] : [],
    ),
  );
  const savedField = typeof saved === "string" ? saved : undefined;
  const frameNames = Object.fromEntries(
    shopItems.flatMap(({ name, effect }) =>
      effect.type === "frame" ? [[effect.frame, name]] : [],
    ),
  );
  const posts = allPosts.slice(0, 6);
  const now = new Date();

  return (
    <>
      <PageHero
        title="Account Dashboard"
        subtitle="Manage and customize your account preferences."
      />
      <PageLayout
        asideSide="start"
        className="pt-0"
        aside={
          <>
            <nav
              aria-label="Account"
              className="overflow-hidden rounded-lg border bg-card [&>section+section>h2]:border-t"
            >
              <SidebarGroup
                title="Your account"
                links={[
                  { label: "Your profile", href: `/members/${user.id}` },
                  { label: "Notifications", href: "/notifications" },
                  { label: "Reactions received", href: "#" },
                  { label: "Bookmarks", href: "#" },
                ]}
              />
              <SidebarGroup title="Settings" links={SETTINGS} />
            </nav>
            <form action={logout}>
              <button
                type="submit"
                className="flex h-11 w-full items-center rounded-lg border bg-card px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Log out
              </button>
            </form>
          </>
        }
      >
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 lg:flex-nowrap">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-44 justify-start gap-2 md:h-8"
            >
              <UserAvatar user={user} size="xs" link={false} />
              <span className="truncate">{user.username}</span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" />
            </Button>
            <UserAvatar
              user={user}
              size="md"
              className="ml-auto flex size-10 items-center justify-center lg:order-last"
            />
            <TabLinks
              tabs={TABS}
              active="Overview"
              label="Account sections"
              variant="plain"
              className="-mx-3 w-[calc(100%+1.5rem)] px-1 lg:mx-0 lg:w-auto lg:px-0"
            />
          </div>

          <div className="space-y-4 p-4 lg:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 lg:pb-2">
              <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
              <p className="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium">
                <CalendarDays className="size-4" />
                <time dateTime={now.toISOString()}>{formatDateTime(now)}</time>
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Total Posts"
                icon={MessageCircle}
                value={formatNumber(user.postCount)}
              />
              <StatTile
                label="Total Reactions"
                icon={Heart}
                value={formatNumber(user.reactionCount)}
              />
              <StatTile
                label="Followers"
                icon={Users}
                value={formatNumber(user.followerCount)}
              />
              <StatTile
                label="Total Reputation"
                icon={Star}
                value={formatNumber(user.reputation)}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <section className="min-w-0 rounded-lg border bg-card p-4">
                <h3 className="mb-4 text-sm font-semibold">
                  Statistics Overview
                </h3>
                <StatsChart
                  data={[
                    { label: "Posts", value: user.postCount },
                    { label: "Threads", value: user.threadCount },
                    { label: "Reputation", value: user.reputation },
                    { label: "Received Reactions", value: user.reactionCount },
                    { label: "Followers", value: user.followerCount },
                  ]}
                />
              </section>
              <section className="min-w-0 rounded-lg border bg-card p-4">
                <h3 className="text-sm font-semibold">Posting Activity</h3>
                <p className="text-xs text-muted-foreground">
                  Your most recent posting activity.
                </p>
                {posts.length ? (
                  <ul className="mt-3 divide-y">
                    {posts.map((post) => (
                      <li key={post.id}>
                        <Link
                          href={`/threads/${post.thread.id}`}
                          className="group flex min-h-12 flex-col justify-center py-2"
                        >
                          <span className="truncate text-sm font-medium underline-offset-4 group-hover:underline">
                            {post.thread.title}
                          </span>
                          <time
                            dateTime={post.createdAt}
                            className="text-xs text-muted-foreground"
                          >
                            {formatRelativeTime(post.createdAt, now)}
                          </time>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground">
                    You have not posted anything yet.
                  </p>
                )}
              </section>
            </div>

            <AppearancePanel
              user={user}
              unlocks={unlocks}
              frameNames={frameNames}
              saved={savedField}
            />

            <PermissionsPanel
              user={user}
              permissions={permissions}
              prices={permissionPrices}
              saved={savedField}
            />

            <section
              id="devices"
              className="scroll-mt-4 rounded-lg border bg-card"
            >
              <div className="border-b p-4">
                <h3 className="text-sm font-semibold">Devices</h3>
                <p className="text-xs text-muted-foreground">
                  Browsers that are signed in to your account.
                </p>
              </div>
              {sessions.length ? (
                <ul className="divide-y">
                  {sessions.map((session) => (
                    <li
                      key={session.id}
                      className="flex min-h-14 items-center gap-3 px-4 py-2.5"
                    >
                      <ClientIcons client={session} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
                          {clientLabel(session)}
                          {session.browser === client.browser &&
                            session.os === client.os && (
                              <Badge variant="success">This device</Badge>
                            )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Signed in{" "}
                          <time dateTime={session.createdAt}>
                            {formatDate(session.createdAt)}
                          </time>
                          <span aria-hidden="true"> · </span>
                          Last used{" "}
                          <time
                            dateTime={session.lastUsedAt}
                            title={formatDateTime(session.lastUsedAt)}
                          >
                            {formatRelativeTime(session.lastUsedAt, now)}
                          </time>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  No devices are signed in.
                </p>
              )}
            </section>
          </div>
        </div>
      </PageLayout>
    </>
  );
}
