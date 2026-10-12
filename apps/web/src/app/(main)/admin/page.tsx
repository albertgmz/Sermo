import { FolderOpen, MessageCircle, MessagesSquare, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { StatTile } from "@/components/forum/stat";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import { getCategories, getForumStats, getUsers } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { titleKeyForLevel } from "@/lib/levels";
import { getCurrentUser } from "@/lib/session";

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (user?.role !== "admin") notFound();
  const t = await getTranslations("admin.admin");

  return (
    <>
      <h2 className="text-lg font-semibold">{t("heading")}</h2>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingTotals")}>
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
            <LoadingRegion label={t("aria.loadingActivity")}>
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
            <LoadingRegion label={t("aria.loadingMembers")}>
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
  const t = await getTranslations("admin.adminTotals");
  const [categories, members] = await Promise.all([
    getCategories(),
    getUsers(),
  ]);
  const forums = categories.flatMap((category) => category.forums);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t("forumsLabel")}
        value={formatNumber(forums.length)}
        icon={FolderOpen}
      />
      <StatTile
        label={t("membersLabel")}
        value={formatNumber(members.length)}
        icon={Users}
      />
      <StatTile
        label={t("threadsLabel")}
        value={formatNumber(
          forums.reduce((sum, forum) => sum + forum.threadCount, 0),
        )}
        icon={MessagesSquare}
      />
      <StatTile
        label={t("postsLabel")}
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
  const t = await getTranslations("admin.adminActivity");
  return (
    <SectionCard title={t("title")} description={t("description")}>
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
              {t.rich("byline", {
                author: () => (
                  <UserLink
                    user={thread.lastPost.author.member}
                    className="relative z-10"
                  />
                ),
                forum: thread.forum.title,
              })}
            </p>
            <RelativeTime
              date={thread.lastPost.createdAt}
              className="block text-xs text-muted-foreground"
            />
          </div>
        ))
      ) : (
        <EmptyState title={t("empty")} description={t("emptyDescription")} />
      )}
    </SectionCard>
  );
}

async function AdminNewestMembers() {
  const members = await getUsers();
  const t = await getTranslations("admin.adminNewestMembers");
  const tLevels = await getTranslations("lib.levels");
  const tRoles = await getTranslations("lib.db.roles");
  const newestMembers = members
    .toSorted((a, b) => b.joinedAt.localeCompare(a.joinedAt))
    .slice(0, 5);

  return (
    <SectionCard title={t("title")} description={t("description")}>
      {newestMembers.length ? (
        newestMembers.map((member) => (
          <MemberRow
            key={member.id}
            user={{
              ...member.member,
              title:
                (member.permissions.includes("customTitle") &&
                  member.customTitle) ||
                (member.role === "member"
                  ? tLevels(titleKeyForLevel(member.level.level))
                  : tRoles(member.role)),
            }}
          />
        ))
      ) : (
        <EmptyState title={t("empty")} />
      )}
    </SectionCard>
  );
}
