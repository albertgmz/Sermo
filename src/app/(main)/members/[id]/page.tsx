import {
  CalendarDays,
  Link2,
  type LucideIcon,
  MapPin,
  MessagesSquare,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ProfileHeader } from "@/app/(main)/members/[id]/profile-header";
import { Wall } from "@/app/(main)/members/[id]/wall";
import { AwardIcon } from "@/components/forum/award-icon";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { Markdown } from "@/components/forum/markdown";
import { MessageBody } from "@/components/forum/message-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { RoleBadge } from "@/components/forum/role-badge";
import { SectionCard } from "@/components/forum/section-card";
import { ShopIcon } from "@/components/forum/shop-icon";
import { Signature } from "@/components/forum/signature";
import {
  FeedSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  ProfileHeaderSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { UserLink } from "@/components/forum/user-link";
import { Container } from "@/components/layout/container";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getInventory,
  getProfilePosts,
  getReactionTypes,
  getUserById,
  getUserPosts,
  getUserThreads,
  type InventoryItemView,
  isFollowing,
  type PostView,
  type ThreadView,
  type UserView,
} from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
};

const TABS = ["wall", "posts", "threads", "about"] as const;
type Tab = (typeof TABS)[number];

const titleLinkClass =
  "text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations("members.profile");
  const { id } = await params;
  const user = await getUserById(Number(id));
  return {
    title: user
      ? t("metaTitle", { username: user.username })
      : t("metaFallbackTitle"),
  };
}

function LevelStrip({ user }: { user: UserView }) {
  const t = useTranslations("members.profile");
  const { level, awards } = user;
  return (
    <section
      aria-label={t("aria.level")}
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3"
    >
      <LevelBadge level={level} className="h-5 px-1.5 text-xs" />
      <XpBar level={level} className="w-24 sm:w-64 lg:w-96" />
      <p className="text-xs tabular-nums text-muted-foreground">
        {t.rich("xp", {
          current: formatNumber(level.xp),
          next: formatNumber(level.nextLevelXp),
          value: (chunks) => (
            <span className="font-semibold text-foreground">{chunks}</span>
          ),
        })}
      </p>
      <Link
        href={`/members/${user.id}?tab=about#awards`}
        className="relative ml-auto text-xs text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-foreground"
      >
        {t.rich("awards", {
          count: awards.length,
          value: (chunks) => (
            <span className="font-semibold text-foreground tabular-nums">
              {chunks}
            </span>
          ),
        })}
      </Link>
    </section>
  );
}

function ProfileCards({
  user,
  inventory,
  activity,
  className,
}: {
  user: UserView;
  inventory: InventoryItemView[];
  activity: PostView[];
  className?: string;
}) {
  const t = useTranslations("members.profile");
  return (
    <div className={cn("grid gap-4", className)}>
      <Card>
        <CardHeader>
          <CardTitle>{t("groupsHeading")}</CardTitle>
          <CardDescription>
            {t.rich("groupsDescription", {
              username: user.username,
              user: () => <UserLink user={user} />,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.role === "member" ? (
            <Badge variant="secondary">{t("memberBadge")}</Badge>
          ) : (
            <RoleBadge user={user} />
          )}
        </CardContent>
      </Card>
      <Card id="awards" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>{t("awardsHeading")}</CardTitle>
          <CardDescription>
            {t.rich("awardsDescription", {
              username: user.username,
              user: () => <UserLink user={user} />,
            })}
          </CardDescription>
        </CardHeader>
        {user.awards.length > 0 ? (
          <CardContent>
            <ul className="-m-1 flex flex-wrap">
              {user.awards.map((award) => (
                <li key={award.id}>
                  <Link
                    href={`/awards/${award.id}`}
                    className="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted"
                  >
                    <AwardIcon award={award} />
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-2 text-center text-muted-foreground">
            {t.rich("awardsEmpty", {
              username: user.username,
              user: () => <UserLink user={user} />,
            })}
          </CardContent>
        )}
      </Card>
      {inventory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("inventoryHeading")}</CardTitle>
            <CardDescription>
              {t.rich("inventoryDescription", {
                username: user.username,
                user: () => <UserLink user={user} />,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-2">
              {inventory.map((item) => (
                <li
                  key={item.id}
                  title={item.description}
                  className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2.5 text-xs font-medium"
                >
                  <ShopIcon
                    category={item.category}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate">{item.name}</span>
                  {item.quantity > 1 && (
                    <span className="text-muted-foreground tabular-nums">
                      {t("quantity", { count: item.quantity })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t("activityHeading")}</CardTitle>
          <CardDescription>
            {t.rich("activityDescription", {
              username: user.username,
              user: () => <UserLink user={user} />,
            })}
          </CardDescription>
        </CardHeader>
        {activity.length > 0 ? (
          <CardContent>
            <ul className="-my-2 divide-y">
              {activity.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/threads/${post.thread.id}#post-${post.id}`}
                    className="group flex min-h-12 flex-col justify-center py-2"
                  >
                    <span className="flex min-w-0 items-center gap-1.5 font-medium underline-offset-4 group-hover:underline">
                      {post.thread.prefix && (
                        <PrefixTag prefix={post.thread.prefix} />
                      )}
                      <span className="truncate">{post.thread.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t.rich(
                        post.number === 1
                          ? "activityStarted"
                          : "activityReplied",
                        {
                          time: () => <RelativeTime date={post.createdAt} />,
                        },
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-2 text-center text-muted-foreground">
            {t.rich("activityEmpty", {
              username: user.username,
              user: () => <UserLink user={user} />,
            })}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Posts({ user, posts }: { user: UserView; posts: PostView[] }) {
  const t = useTranslations("members.profile");
  const format = useFormatter();
  const now = useNow();
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={t("postsEmptyTitle")}
        description={t.rich("postsEmptyDescription", {
          username: user.username,
          user: () => <UserLink user={user} />,
        })}
      />
    );
  }
  return posts.map((post) => (
    <article key={post.id} className="px-4 py-3">
      <h3>
        <Link href={`/threads/${post.thread.id}`} className={titleLinkClass}>
          {post.thread.prefix && (
            <PrefixTag
              prefix={post.thread.prefix}
              className="mr-1.5 align-(--prefix-offset)"
            />
          )}
          {post.thread.title}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t("postDetails", {
          number: formatNumber(post.number),
          time: format.relativeTime(new Date(post.createdAt), now),
        })}
      </p>
      <MessageBody clamp className="mt-2 text-muted-foreground">
        {post.body}
      </MessageBody>
    </article>
  ));
}

function Threads({ user, threads }: { user: UserView; threads: ThreadView[] }) {
  const t = useTranslations("members.profile");
  const format = useFormatter();
  const now = useNow();
  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title={t("threadsEmptyTitle")}
        description={t.rich("threadsEmptyDescription", {
          username: user.username,
          user: () => <UserLink user={user} />,
        })}
      />
    );
  }
  return threads.map((thread) => (
    <article key={thread.id} className="px-4 py-3">
      <h3>
        <Link href={`/threads/${thread.id}`} className={titleLinkClass}>
          {thread.prefix && (
            <PrefixTag
              prefix={thread.prefix}
              className="mr-1.5 align-(--prefix-offset)"
            />
          )}
          {thread.title}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {t.rich("threadDetails", {
          title: thread.forum.title,
          time: format.relativeTime(new Date(thread.createdAt), now),
          replies: t("replies", { count: thread.replyCount }),
          views: t("views", { count: thread.views }),
          forum: (chunks) => (
            <Link
              href={`/forums/${thread.forum.id}`}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </article>
  ));
}

function Detail({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-3 px-4 py-2 text-sm">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <dt className="w-20 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function About({ user, cards }: { user: UserView; cards: React.ReactNode }) {
  const t = useTranslations("members.profile");
  return (
    <div className="space-y-4">
      <SectionCard title={t("aboutHeading")}>
        <div className="px-4 py-3">
          {user.bio ? (
            <Markdown>{user.bio}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.rich("bioEmpty", {
                username: user.username,
                user: () => <UserLink user={user} />,
              })}
            </p>
          )}
        </div>
        {user.signature && can(user, "signature") && (
          <div className="px-4 py-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("signatureHeading")}
            </h3>
            <Signature>{user.signature}</Signature>
          </div>
        )}
        <dl className="divide-y divide-border">
          <Detail icon={CalendarDays} label={t("joinedLabel")}>
            {formatDate(user.joinedAt)}
          </Detail>
          {user.location && (
            <Detail icon={MapPin} label={t("locationLabel")}>
              {user.location}
            </Detail>
          )}
          {user.website && (
            <Detail icon={Link2} label={t("websiteLabel")}>
              <a
                href={user.website}
                target="_blank"
                rel="noreferrer nofollow"
                className="font-medium text-primary underline underline-offset-4 hover:no-underline"
              >
                {user.website.replace(/^https?:\/\//, "")}
              </a>
            </Detail>
          )}
        </dl>
      </SectionCard>
      {cards}
    </div>
  );
}

export default async function ProfilePage({ params, searchParams }: Props) {
  const t = await getTranslations("members.profile");
  const [{ id }, query, viewer] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
  ]);
  const user = await getUserById(Number(id));
  if (!user) notFound();

  const tab: Tab = TABS.find((value) => value === query.tab) ?? "wall";
  const cards = (className?: string) => (
    <Suspense
      fallback={
        <LoadingRegion label={t("loadingDetails")}>
          <div className={cn("grid gap-4", className)}>
            <MemberListSkeleton rows={1} />
            <MemberListSkeleton rows={1} />
            <MemberListSkeleton />
          </div>
        </LoadingRegion>
      }
    >
      <ProfileDetails user={user} viewer={viewer} className={className} />
    </Suspense>
  );

  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingHeader")}>
            <ProfileHeaderSkeleton />
          </LoadingRegion>
        }
      >
        <ProfileHeading user={user} viewer={viewer} />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingSections")}>
            <Container className="pt-5">
              <Skeleton className="mb-4 h-12 w-full" />
              <TabsSkeleton />
            </Container>
          </LoadingRegion>
        }
      >
        <ProfileTabs user={user} viewer={viewer} tab={tab} />
      </Suspense>
      {tab === "about" ? (
        <PageLayout>
          <About user={user} cards={cards("md:grid-cols-2")} />
        </PageLayout>
      ) : (
        <PageLayout aside={cards()} asideOnMobile="hidden">
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingActivity")}>
                <FeedSkeleton />
              </LoadingRegion>
            }
          >
            <ProfileActivity user={user} viewer={viewer} tab={tab} />
          </Suspense>
        </PageLayout>
      )}
    </>
  );
}

async function ProfileHeading({
  user,
  viewer,
}: {
  user: UserView;
  viewer: UserView | null;
}) {
  const following = viewer ? await isFollowing(viewer.id, user.id) : false;
  return <ProfileHeader user={user} viewer={viewer} following={following} />;
}

async function ProfileTabs({
  user,
  viewer,
  tab,
}: {
  user: UserView;
  viewer: UserView | null;
  tab: Tab;
}) {
  const t = await getTranslations("members.profile");
  const wallPosts = await getProfilePosts(user.id, viewer?.id ?? null);
  const base = `/members/${user.id}`;
  const tabs = [
    { value: "wall", label: t("wallTab"), href: base, count: wallPosts.length },
    {
      value: "posts",
      label: t("postsTab"),
      href: `${base}?tab=posts`,
      count: user.postCount,
    },
    {
      value: "threads",
      label: t("threadsTab"),
      href: `${base}?tab=threads`,
      count: user.threadCount,
    },
    { value: "about", label: t("aboutTab"), href: `${base}?tab=about` },
  ];

  return (
    <Container className="pt-5">
      <LevelStrip user={user} />
      <TabLinks tabs={tabs} active={tab} label={t("aria.sections")} />
    </Container>
  );
}

async function ProfileDetails({
  user,
  viewer,
  className,
}: {
  user: UserView;
  viewer: UserView | null;
  className?: string;
}) {
  const [inventory, posts] = await Promise.all([
    getInventory(user.id),
    getUserPosts(user.id, viewer?.id ?? null),
  ]);
  return (
    <ProfileCards
      user={user}
      inventory={inventory}
      activity={posts.slice(0, 5)}
      className={className}
    />
  );
}

async function ProfileActivity({
  user,
  viewer,
  tab,
}: {
  user: UserView;
  viewer: UserView | null;
  tab: Tab;
}) {
  const t = await getTranslations("members.profile");
  const [wallPosts, posts, threads, reactionTypes] = await Promise.all([
    tab === "wall" ? getProfilePosts(user.id, viewer?.id ?? null) : [],
    tab === "posts" ? getUserPosts(user.id, viewer?.id ?? null) : [],
    tab === "threads" ? getUserThreads(user.id) : [],
    getReactionTypes(),
  ]);
  return (
    <>
      {tab === "wall" ? (
        <Wall
          user={user}
          viewer={viewer}
          posts={wallPosts}
          reactionTypes={reactionTypes}
        />
      ) : (
        <section className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
          <h2 className="sr-only">
            {t(tab === "posts" ? "postsTab" : "threadsTab")}
          </h2>
          {tab === "posts" ? (
            <Posts user={user} posts={posts} />
          ) : (
            <Threads user={user} threads={threads} />
          )}
        </section>
      )}
    </>
  );
}
