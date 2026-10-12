import { FolderOpen, MessageCircle, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { StatTile } from "@/components/forum/stat";
import { UserLink } from "@/components/forum/user-link";
import { getCategories, getForumStats, getUsers } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();

  const [categories, members, activity] = await Promise.all([
    getCategories(),
    getUsers(),
    getForumStats(6),
  ]);
  const forums = categories.flatMap((category) => category.forums);
  const newestMembers = members
    .toSorted((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .slice(0, 5);

  return (
    <>
      <h2 className="text-lg font-semibold">Dashboard</h2>
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
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Recent activity"
          description="Latest posts across the forums"
        >
          {activity.latestPosts.length ? (
            activity.latestPosts.map((thread) => (
              <div
                key={thread.id}
                className="relative space-y-1 px-4 py-3 transition-colors hover:bg-muted/50"
              >
                <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                  {thread.prefix && <PrefixTag prefix={thread.prefix} />}
                  <Link
                    href={`/threads/${thread.id}#post-${thread.lastPost.postId}`}
                    className="truncate after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {thread.title}
                  </Link>
                </p>
                <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  <UserLink
                    user={thread.lastPost.author}
                    className="relative z-10"
                  />{" "}
                  · {thread.forum.title}
                </p>
                <RelativeTime
                  date={thread.lastPost.createdAt}
                  className="block text-xs text-muted-foreground"
                />
              </div>
            ))
          ) : (
            <EmptyState
              title="No activity yet"
              description="New forum posts will appear here."
            />
          )}
        </SectionCard>
        <SectionCard
          title="Newest members"
          description="The latest people to join"
        >
          {newestMembers.length ? (
            newestMembers.map((member) => (
              <MemberRow key={member.id} user={member} />
            ))
          ) : (
            <EmptyState title="No members yet" />
          )}
        </SectionCard>
      </div>
    </>
  );
}
