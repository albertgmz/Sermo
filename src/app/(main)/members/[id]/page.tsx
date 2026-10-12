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
import { ProfileHeader } from "@/app/(main)/members/[id]/profile-header";
import { Wall } from "@/app/(main)/members/[id]/wall";
import { AwardIcon } from "@/components/forum/award-icon";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { Markdown } from "@/components/forum/markdown";
import { MessageBody } from "@/components/forum/message-row";
import { RelativeTime } from "@/components/forum/relative-time";
import { RoleBadge } from "@/components/forum/role-badge";
import { SectionCard } from "@/components/forum/section-card";
import { ShopIcon } from "@/components/forum/shop-icon";
import { Signature } from "@/components/forum/signature";
import { TabLinks } from "@/components/forum/tab-links";
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
import { formatDate, formatNumber, formatRelativeTime } from "@/lib/format";
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
  const { id } = await params;
  const user = await getUserById(Number(id));
  return { title: `${user?.username ?? "Member"} - forum/ui` };
}

function LevelStrip({ user }: { user: UserView }) {
  const { level, awards } = user;
  return (
    <section
      aria-label="Level"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3"
    >
      <LevelBadge level={level} className="h-5 px-1.5 text-xs" />
      <XpBar level={level} className="w-24 sm:w-64 lg:w-96" />
      <p className="text-xs tabular-nums text-muted-foreground">
        <span className="font-semibold text-foreground">
          {formatNumber(level.xp)}
        </span>{" "}
        / {formatNumber(level.nextLevelXp)} XP
      </p>
      <Link
        href={`/members/${user.id}?tab=about#awards`}
        className="relative ml-auto text-xs text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-foreground"
      >
        <span className="font-semibold text-foreground tabular-nums">
          {formatNumber(awards.length)}
        </span>{" "}
        {awards.length === 1 ? "award" : "awards"}
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
  return (
    <div className={cn("grid gap-4", className)}>
      <Card>
        <CardHeader>
          <CardTitle>Groups</CardTitle>
          <CardDescription>Explore {user.username}'s groups.</CardDescription>
        </CardHeader>
        <CardContent>
          {user.role === "member" ? (
            <Badge variant="secondary">Member</Badge>
          ) : (
            <RoleBadge user={user} />
          )}
        </CardContent>
      </Card>
      <Card id="awards" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>Awards</CardTitle>
          <CardDescription>
            Explore {user.username}'s awards collection.
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
            {user.username} has no awards at this time.
          </CardContent>
        )}
      </Card>
      {inventory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
            <CardDescription>
              Items {user.username} got from the shop.
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
                      ×{item.quantity}
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
          <CardTitle>Latest activity</CardTitle>
          <CardDescription>
            What {user.username} has been up to lately.
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
                    <span className="truncate font-medium underline-offset-4 group-hover:underline">
                      {post.thread.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {post.number === 1 ? "Started a thread" : "Replied"} ·{" "}
                      <RelativeTime date={post.createdAt} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-2 text-center text-muted-foreground">
            {user.username} has no recent activity.
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Posts({ user, posts }: { user: UserView; posts: PostView[] }) {
  if (posts.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No posts yet"
        description={`${user.username} has not posted in the forums.`}
      />
    );
  }
  return posts.map((post) => (
    <article key={post.id} className="px-4 py-3">
      <h3>
        <Link href={`/threads/${post.thread.id}`} className={titleLinkClass}>
          {post.thread.title}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Post #{post.number} · {formatRelativeTime(post.createdAt)}
      </p>
      <MessageBody clamp className="mt-2 text-muted-foreground">
        {post.body}
      </MessageBody>
    </article>
  ));
}

function Threads({ user, threads }: { user: UserView; threads: ThreadView[] }) {
  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No threads yet"
        description={`${user.username} has not started a thread.`}
      />
    );
  }
  return threads.map((thread) => (
    <article key={thread.id} className="px-4 py-3">
      <h3>
        <Link href={`/threads/${thread.id}`} className={titleLinkClass}>
          {thread.title}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        <Link
          href={`/forums/${thread.forum.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {thread.forum.title}
        </Link>{" "}
        · {formatRelativeTime(thread.createdAt)} ·{" "}
        {formatNumber(thread.replyCount)}{" "}
        {thread.replyCount === 1 ? "reply" : "replies"} ·{" "}
        {formatNumber(thread.views)} views
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
  return (
    <div className="space-y-4">
      <SectionCard title="About">
        <div className="px-4 py-3">
          {user.bio ? (
            <Markdown>{user.bio}</Markdown>
          ) : (
            <p className="text-sm text-muted-foreground">
              {user.username} has not written a bio yet.
            </p>
          )}
        </div>
        {user.signature && can(user, "signature") && (
          <div className="px-4 py-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Signature
            </h3>
            <Signature>{user.signature}</Signature>
          </div>
        )}
        <dl className="divide-y divide-border">
          <Detail icon={CalendarDays} label="Joined">
            {formatDate(user.joinedAt)}
          </Detail>
          {user.location && (
            <Detail icon={MapPin} label="Location">
              {user.location}
            </Detail>
          )}
          {user.website && (
            <Detail icon={Link2} label="Website">
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
  const [{ id }, query, viewer] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
  ]);
  const user = await getUserById(Number(id));
  if (!user) notFound();

  const tab: Tab = TABS.find((value) => value === query.tab) ?? "wall";
  const [following, wallPosts, posts, threads, reactionTypes, inventory] =
    await Promise.all([
      viewer ? isFollowing(viewer.id, user.id) : false,
      getProfilePosts(user.id, viewer?.id ?? null),
      getUserPosts(user.id, viewer?.id ?? null),
      tab === "threads" ? getUserThreads(user.id) : [],
      getReactionTypes(),
      getInventory(user.id),
    ]);
  const cards = (className?: string) => (
    <ProfileCards
      user={user}
      inventory={inventory}
      activity={posts.slice(0, 5)}
      className={className}
    />
  );

  const base = `/members/${user.id}`;
  const tabs = [
    { value: "wall", label: "Wall", href: base, count: wallPosts.length },
    {
      value: "posts",
      label: "Posts",
      href: `${base}?tab=posts`,
      count: user.postCount,
    },
    {
      value: "threads",
      label: "Threads",
      href: `${base}?tab=threads`,
      count: user.threadCount,
    },
    { value: "about", label: "About", href: `${base}?tab=about` },
  ];

  return (
    <>
      <ProfileHeader user={user} viewer={viewer} following={following} />
      <Container className="pt-5">
        <LevelStrip user={user} />
        <TabLinks tabs={tabs} active={tab} label="Profile sections" />
      </Container>
      {tab === "about" ? (
        <PageLayout>
          <About user={user} cards={cards("md:grid-cols-2")} />
        </PageLayout>
      ) : (
        <PageLayout aside={cards()} asideOnMobile="hidden">
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
                {tab === "posts" ? "Posts" : "Threads"}
              </h2>
              {tab === "posts" ? (
                <Posts user={user} posts={posts} />
              ) : (
                <Threads user={user} threads={threads} />
              )}
            </section>
          )}
        </PageLayout>
      )}
    </>
  );
}
