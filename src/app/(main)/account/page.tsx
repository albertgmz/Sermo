import { CalendarDays, Heart, MessageCircle, Star, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StatsChart } from "@/app/(main)/account/stats-chart";
import { StatTile } from "@/components/forum/stat";
import { getUserPosts } from "@/lib/db";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account overview - forum/ui" };

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const posts = (await getUserPosts(user.id, user.id)).slice(0, 6);
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 lg:pb-2">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
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

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="min-w-0 rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-sm font-semibold">Statistics Overview</h2>
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
          <h2 className="text-sm font-semibold">Posting Activity</h2>
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
    </div>
  );
}
