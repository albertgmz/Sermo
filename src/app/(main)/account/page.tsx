import { CalendarDays, Heart, MessageCircle, Star, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AccountDetails } from "@/app/(main)/account/account-details";
import {
  AccountActivitySkeleton,
  AccountDetailsSkeleton,
} from "@/app/(main)/account/overview-skeletons";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { LoadingRegion } from "@/components/forum/skeletons";
import { StatTile } from "@/components/forum/stat";
import { getUserPosts } from "@/lib/db";
import { formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = { title: "Account overview - forum/ui" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
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

      <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Suspense
          fallback={
            <LoadingRegion label="Loading account details…">
              <AccountDetailsSkeleton />
            </LoadingRegion>
          }
        >
          <AccountDetails searchParams={searchParams} />
        </Suspense>
        <Suspense
          fallback={
            <LoadingRegion label="Loading posting activity…">
              <AccountActivitySkeleton />
            </LoadingRegion>
          }
        >
          <AccountActivity userId={user.id} now={now} />
        </Suspense>
      </div>
    </div>
  );
}

async function AccountActivity({ userId, now }: { userId: number; now: Date }) {
  const posts = (await getUserPosts(userId, userId)).slice(0, 6);
  return (
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
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium underline-offset-4 group-hover:underline">
                  {post.thread.prefix && (
                    <PrefixTag prefix={post.thread.prefix} />
                  )}
                  <span className="truncate">{post.thread.title}</span>
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
  );
}
