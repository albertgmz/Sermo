import { FolderOpen, MessageCircle, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { StatTile } from "@/components/forum/stat";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategories, getForumStats, getUsers } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  return (
    <>
      <h2 className="text-lg font-semibold">Dashboard</h2>
      <Suspense
        fallback={
          <LoadingRegion label="Loading community totals…">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[1, 2, 3, 4].map((row) => (
                <StatTileSkeleton key={row} />
              ))}
            </div>
          </LoadingRegion>
        }
      >
        <AdminTotals />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense
          fallback={
            <LoadingRegion label="Loading recent activity…">
              <CardSkeleton>
                {[1, 2, 3, 4, 5, 6].map((row) => (
                  <div key={row} className="space-y-2 px-4 py-3">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                ))}
              </CardSkeleton>
            </LoadingRegion>
          }
        >
          <AdminActivity />
        </Suspense>
        <Suspense
          fallback={
            <LoadingRegion label="Loading newest members…">
              <MemberListSkeleton />
            </LoadingRegion>
          }
        >
          <AdminNewestMembers />
        </Suspense>
      </div>
    </>
  );
}

async function AdminTotals() {
  const [categories, members] = await Promise.all([
    getCategories(),
    getUsers(),
  ]);
  const forums = categories.flatMap((category) => category.forums);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="Forums"
        value={formatNumber(forums.length)}
        icon={FolderOpen}
      />
      <StatTile
        label="Members"
        value={formatNumber(members.length)}
        icon={Users}
      />
      <StatTile
        label="Threads"
        value={formatNumber(
          forums.reduce((sum, forum) => sum + forum.threadCount, 0),
        )}
        icon={MessagesSquare}
      />
      <StatTile
        label="Posts"
        value={formatNumber(
          forums.reduce((sum, forum) => sum + forum.postCount, 0),
        )}
        icon={MessageCircle}
      />
    </div>
  );
}

async function AdminActivity() {
  const activity = await getForumStats(6);
  return (
    <SectionCard
      title="Recent activity"
      description="Latest posts across the forums"
    >
      {activity.latestPosts.length ? (
        activity.latestPosts.map((thread) => (
          <Link
            key={thread.id}
            href={`/threads/${thread.id}#post-${thread.lastPost.postId}`}
            className="block space-y-1 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <p className="truncate text-sm font-medium">{thread.title}</p>
            <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {thread.lastPost.author.username} · {thread.forum.title}
            </p>
            <RelativeTime
              date={thread.lastPost.createdAt}
              className="block text-xs text-muted-foreground"
            />
          </Link>
        ))
      ) : (
        <EmptyState
          title="No activity yet"
          description="New forum posts will appear here."
        />
      )}
    </SectionCard>
  );
}

async function AdminNewestMembers() {
  const members = await getUsers();
  const newestMembers = members
    .toSorted((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .slice(0, 5);

  return (
    <SectionCard title="Newest members" description="The latest people to join">
      {newestMembers.length ? (
        newestMembers.map((member) => (
          <MemberRow key={member.id} user={member} />
        ))
      ) : (
        <EmptyState title="No members yet" />
      )}
    </SectionCard>
  );
}
