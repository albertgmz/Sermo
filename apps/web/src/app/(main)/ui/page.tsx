import {
  Bell,
  CircleDollarSign,
  Flag,
  Heart,
  MessageCircle,
  MessagesSquare,
  Reply,
  Star,
  Store,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AccountNavigation } from "@/app/(main)/account/navigation";
import { AdminNavigation } from "@/app/(main)/admin/navigation";
import { LiteSettingsForm } from "@/app/(main)/lite/settings-form";
import { CoverControls } from "@/app/(main)/threads/[id]/cover-controls";
import { discard } from "@/app/(main)/ui/actions";
import { EditorDemo } from "@/app/(main)/ui/editor-demo";
import { LiteMenuDemo } from "@/app/(main)/ui/lite-menu-demo";
import { ReactionDemo } from "@/app/(main)/ui/reaction-demo";
import { SkeletonDemos } from "@/app/(main)/ui/skeleton-demos";
import { Art } from "@/components/forum/art";
import { AwardIcon, AwardRow } from "@/components/forum/award-icon";
import { ClientIcons, clientLabel } from "@/components/forum/client-icons";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { CompactComposer } from "@/components/forum/compact-composer";
import { ConversationPreview } from "@/components/forum/conversation-preview";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { Credits } from "@/components/forum/credits";
import { EmptyState } from "@/components/forum/empty-state";
import { ForumCard } from "@/components/forum/forum-card";
import { ForumIcon } from "@/components/forum/forum-icon";
import {
  Leaderboard,
  LeaderboardScore,
  RankNumber,
} from "@/components/forum/leaderboard";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import { Markdown } from "@/components/forum/markdown";
import { MemberCard } from "@/components/forum/member-card";
import { MemberRow } from "@/components/forum/member-row";
import {
  MessageBody,
  MessageRow,
  messageActionClass,
} from "@/components/forum/message-row";
import { NotificationRow } from "@/components/forum/notification-row";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PendingButton } from "@/components/forum/pending-button";
import { PermissionIcon } from "@/components/forum/permission-icon";
import { Podium } from "@/components/forum/podium";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { RoleBadge } from "@/components/forum/role-badge";
import { SectionCard } from "@/components/forum/section-card";
import { ShareButton } from "@/components/forum/share-button";
import { ShopIcon } from "@/components/forum/shop-icon";
import { Signature } from "@/components/forum/signature";
import { SocialIcon } from "@/components/forum/social-icon";
import {
  MonthHero,
  StandingList,
  WinnerList,
} from "@/components/forum/standing";
import { StatInline, StatTile } from "@/components/forum/stat";
import { TabLinks } from "@/components/forum/tab-links";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UnreadDot } from "@/components/forum/unread-dot";
import { UserAvatar } from "@/components/forum/user-avatar";
import {
  DonorBadge,
  RankBadge,
  UserBadges,
} from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { HeaderPanel } from "@/components/layout/header-panel";
import { headerIconClass } from "@/components/layout/header-panels";
import { Logo, LogoMark } from "@/components/layout/logo";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import {
  HeaderNav,
  MobileMenu,
  SearchForm,
} from "@/components/layout/site-nav";
import { StaffBar } from "@/components/layout/staff-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ACCENTS, COVERS, NAME_COLORS, threadCoverSrc } from "@/lib/appearance";
import {
  getAwards,
  getCategories,
  getCurrentMonthStanding,
  getForumStats,
  getLeaderboard,
  getMemberOfTheMonth,
  getPastWinners,
  getPosts,
  getPrefixes,
  getRanks,
  getReactionTypes,
  getShopItems,
  getThread,
  getUsers,
} from "@/lib/db";
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { getLiteState } from "@/lib/lite-mode";
import { serializeLiteCookie } from "@/lib/lite-preferences";
import { PERMISSIONS } from "@/lib/permissions";
import type { Browser, Os, ShopCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Styleguide - forum/ui",
};

const TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "destructive",
  "success",
  "tier-bronze",
  "tier-silver",
  "tier-gold",
  "tier-legendary",
  "name-rose",
  "name-coral",
  "name-lime",
  "name-emerald",
  "name-cyan",
  "name-sky",
  "name-indigo",
  "name-pink",
  "name-silver",
  "name-gold",
  "name-legendary",
  "prefix-sky",
  "prefix-emerald",
  "prefix-orange",
  "prefix-violet",
  "prefix-amber",
  "prefix-cyan",
  "prefix-rose",
  "prefix-lime",
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

const RADII = [
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
  ["4xl", "rounded-4xl"],
] as const;

const LEADERBOARD_KINDS = [
  "xp",
  "credits",
  "posts",
  "reactions",
  "awards",
  "referrals",
] as const;

const BROWSERS: Browser[] = [
  "chrome",
  "firefox",
  "safari",
  "edge",
  "opera",
  "other",
];

const SYSTEMS: Os[] = ["windows", "macos", "linux", "android", "ios", "other"];

const SHOP_CATEGORIES: ShopCategory[] = [
  "frame",
  "color",
  "threadCover",
  "boost",
  "permission",
];

const AVATAR_SIZES = ["xs", "sm", "md", "lg", "xl", "2xl"] as const;

const SAMPLE = `## Markdown sample

A paragraph with **bold**, *italic*, ~~strikethrough~~, \`inline code\` and a [link](/ui).

- First item
- Second item
  - Nested item

1. Step one
2. Step two

> If everything glows, nothing does.

\`\`\`ts
export function greet(name: string) {
  return \`Hello, \${name}\`;
}
\`\`\`
`;

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <h2 className="border-b pb-2 text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function StyleguidePage() {
  const [
    users,
    categories,
    awards,
    reactionTypes,
    posts,
    prefixes,
    ranks,
    stats,
    winner,
    pastWinners,
    race,
    shopItems,
    leaders,
    lite,
  ] = await Promise.all([
    getUsers(),
    getCategories(),
    getAwards(),
    getReactionTypes(),
    getPosts(1, null),
    getPrefixes(),
    getRanks(),
    getForumStats(2),
    getMemberOfTheMonth(),
    getPastWinners(3),
    getCurrentMonthStanding(3),
    getShopItems(),
    getLeaderboard("xp", 6),
    getLiteState(),
  ]);
  const liteText = await getTranslations("lite.page.demo");
  const prefixCategory = categories.find((category) =>
    category.forums.some((forum) => forum.lastPost?.prefix),
  );
  const prefixForum = prefixCategory?.forums.find(
    (forum) => forum.lastPost?.prefix,
  );
  const prefixThread = prefixForum?.lastPost
    ? await getThread(prefixForum.lastPost.threadId)
    : null;
  const forumCategory = prefixCategory ?? categories[0];
  const threadCovers = shopItems.flatMap((item) =>
    item.effect.type === "threadCover"
      ? [
          {
            itemId: item.id,
            name: item.name,
            src: threadCoverSrc(item.effect.cover),
            quantity: 1,
          },
        ]
      : [],
  );
  const [admin, moderator, member] = users;
  const coveredMember = users.find((user) => user.appearance.cover);
  const sampleWinner = winner ?? pastWinners[0];
  const ranked = users.filter((user) => user.rank);
  const reacted = posts.toSorted(
    (a, b) => b.reactions.total - a.reactions.total,
  )[0];
  const sampleDate = users[0].joinedAt;
  const notifications = [
    {
      actor: prefixThread?.lastPost.author ?? moderator,
      text: `replied to your thread “${prefixThread?.title ?? "Sample thread"}”`,
      prefix: prefixThread?.prefix,
    },
    { actor: member, text: "started following you" },
    { actor: admin, text: "wrote on your profile" },
  ].map((item, id) => ({
    ...item,
    id,
    href: id === 0 && prefixThread ? `/threads/${prefixThread.id}` : "/ui",
    createdAt:
      id === 0 && prefixThread ? prefixThread.lastPost.createdAt : sampleDate,
    read: id > 0,
  }));
  const conversations = [
    { title: "Sample conversation", participants: [admin, moderator] },
    { title: "Group conversation", participants: [admin, moderator, member] },
  ].map((item, id) => ({
    ...item,
    id,
    unread: id === 0,
    lastMessage: {
      author: moderator,
      body: "The **last message** shows here as plain text.",
      createdAt: sampleDate,
    },
  }));

  return (
    <>
      <PageHero
        title="Styleguide"
        subtitle="Every token and reusable component of forum/ui in one place."
      >
        <Button variant="outline">Secondary action</Button>
        <Button>Primary action</Button>
      </PageHero>

      <PageLayout mainClassName="space-y-12">
        <Section title="Colors">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {TOKENS.map((token) => (
              <li
                key={token}
                className="overflow-hidden rounded-lg border bg-card"
              >
                <div
                  className="h-14 border-b"
                  style={{ background: `var(--${token})` }}
                />
                <p className="truncate px-2 py-1.5 font-mono text-xs text-muted-foreground">
                  --{token}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Radii and spacing">
          <p className="max-w-prose text-sm text-muted-foreground">
            Corner sizes are derived from <code>--radius</code>; the large
            radius uses that base value. Page layouts share
            <code> --page-gap</code> and <code>--aside-width</code>.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RADII.map(([size, className]) => (
              <li
                key={size}
                className={cn(
                  "border bg-card p-4 font-mono text-xs",
                  className,
                )}
              >
                --radius-{size}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-(--page-gap)">
            <div className="rounded-lg border bg-card p-4 text-sm">
              Page gap
            </div>
            <div className="w-(--aside-width) max-w-full rounded-lg border bg-card p-4 text-sm">
              Aside width
            </div>
          </div>
        </Section>

        <Section title="Accent presets">
          <p className="max-w-prose text-sm text-muted-foreground">
            A member picks one for themselves; <code>data-accent</code>{" "}
            recolours a subtree like these previews.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ACCENTS.map((accent) => (
              <li
                key={accent.key}
                data-accent={accent.key}
                className="space-y-3 rounded-lg border bg-card p-3"
              >
                <p className="text-sm font-semibold text-primary">
                  {accent.label}
                </p>
                <Button className="w-full">Action</Button>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Page layout">
          <p className="max-w-prose text-sm text-muted-foreground">
            Every page is a container with a main column and an optional aside
            of one fixed width. The aside stacks below the main column on small
            screens, or is hidden there.
          </p>
          <PageLayout
            className="rounded-lg border border-dashed px-3 py-3"
            aside={
              <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
                Aside
              </div>
            }
          >
            <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              Main column
            </div>
          </PageLayout>
        </Section>

        <Section title="Typography">
          <div className="space-y-3">
            <p className="text-[clamp(2rem,1.2rem+4vw,3.75rem)] leading-[1.05] font-bold tracking-tighter">
              Display heading
            </p>
            <p className="text-2xl font-semibold tracking-tight">Page title</p>
            <p className="text-lg font-semibold tracking-tight">
              Section title
            </p>
            <p className="text-sm font-semibold">Card title</p>
            <p className="max-w-prose text-sm leading-relaxed">
              Body text is set in Inter at 14 pixels with relaxed leading. It
              stays readable on near black surfaces without glowing.
            </p>
            <p className="text-sm text-muted-foreground">
              Muted text for descriptions and metadata.
            </p>
            <p className="text-xs text-muted-foreground">
              Caption: {formatDateTime(sampleDate)} ·{" "}
              {formatRelativeTime(sampleDate)} · {formatDate(sampleDate)} ·{" "}
              {formatCompact(24512)} · {formatNumber(324472)}
            </p>
            <p className="font-mono text-sm">const mono = "Geist Mono";</p>
          </div>
        </Section>

        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="xs">Extra small</Button>
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Like">
              <Heart />
            </Button>
            <Button variant="outline" size="icon" aria-label="Favorite">
              <Star />
            </Button>
          </div>
          <form action={discard}>
            <PendingButton variant="outline">Pending button</PendingButton>
          </form>
        </Section>

        <Section title="Quiet actions">
          <div className="-ml-2 flex flex-wrap items-center gap-1">
            <button type="button" className={messageActionClass}>
              <Flag />
              Report
            </button>
            <button type="button" className={messageActionClass}>
              <Heart />3
            </button>
            <button type="button" aria-pressed className={messageActionClass}>
              <Heart className="fill-current" />4
            </button>
            <ShareButton href="/ui" className={messageActionClass} />
            <Link href="#" className={messageActionClass}>
              <Reply />
              Reply
            </Link>
          </div>
        </Section>

        <Section title="Breadcrumb">
          <PageBreadcrumb
            items={[
              { label: "Home", href: "/" },
              { label: categories[0].title, href: "/forums" },
              { label: categories[0].forums[0].title },
            ]}
          />
        </Section>

        <Section title="Badges">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>New</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
            <Badge variant="success">
              <Star />
              Thread Author
            </Badge>
            <RoleBadge user={admin} />
            <RoleBadge user={moderator} />
            <RoleBadge user={member} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {prefixes.map((prefix) => (
              <PrefixTag key={prefix.id} prefix={prefix} />
            ))}
            <PrefixTag prefix={prefixes[0]} icon={false} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {ranks.map((rank) => (
              <RankBadge key={rank.id} rank={rank} />
            ))}
            <DonorBadge />
            {ranked.map((user) => (
              <span key={user.id} className="inline-flex items-center gap-1.5">
                <UserLink user={user} className="text-sm" />
                <UserBadges user={user} />
              </span>
            ))}
          </div>
        </Section>

        <Section title="Inputs">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sg-username">Username</Label>
              <Input id="sg-username" placeholder="Pick a username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sg-invalid">Invalid</Label>
              <Input id="sg-invalid" aria-invalid defaultValue="taken" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="sg-bio">Bio</Label>
              <Textarea id="sg-bio" placeholder="Tell us about yourself" />
            </div>
            <div className="flex min-h-10 items-center gap-2">
              <Checkbox id="sg-stay" defaultChecked />
              <Label htmlFor="sg-stay">Stay logged in</Label>
            </div>
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">
                <MessageCircle />
                General
              </TabsTrigger>
              <TabsTrigger value="market">
                <Store />
                Market
              </TabsTrigger>
              <TabsTrigger value="money">
                <CircleDollarSign />
                Money
              </TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="text-muted-foreground">
              General forums.
            </TabsContent>
            <TabsContent value="market" className="text-muted-foreground">
              Market forums.
            </TabsContent>
            <TabsContent value="money" className="text-muted-foreground">
              Money forums.
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="overview">
            <TabsList variant="line">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="account">Account</TabsTrigger>
              <TabsTrigger value="privacy">Privacy</TabsTrigger>
            </TabsList>
          </Tabs>
        </Section>

        <Section title="Tab links">
          <TabLinks
            tabs={[
              { value: "wall", label: "Wall", href: "#", count: 4 },
              { value: "posts", label: "Posts", href: "#", count: 10 },
              { value: "about", label: "About", href: "#" },
            ]}
            active="wall"
            label="Underline tab links"
          />
          <TabLinks
            tabs={[
              {
                value: "general",
                label: "General",
                href: "#",
                icon: <MessageCircle className="size-4" />,
              },
              {
                value: "market",
                label: "Market",
                href: "#",
                icon: <Store className="size-4 text-primary" />,
              },
              {
                value: "money",
                label: "Money",
                href: "#",
                icon: <CircleDollarSign className="size-4 text-primary" />,
              },
            ]}
            active="general"
            label="Segmented tab links"
            variant="segmented"
          />
          <TabLinks
            tabs={[
              { value: "overview", label: "Overview", href: "#" },
              { value: "account", label: "Account", href: "#" },
              { value: "privacy", label: "Privacy", href: "#" },
            ]}
            active="overview"
            label="Plain tab links"
            variant="plain"
            className="-ml-2"
          />
        </Section>

        <Section title="Account and admin navigation">
          <p className="max-w-prose text-sm text-muted-foreground">
            Account sections scroll within their bar on small screens and become
            a grouped sidebar on desktop. Admin sections wrap into two columns
            on a phone. These links open the real sections. On this page, the
            account menu has no active section and the admin menu defaults to
            Dashboard.
          </p>
          <PageLayout
            aside={<AccountNavigation />}
            asideSide="start"
            className="px-0 pt-0 pb-0"
          >
            <AdminNavigation />
          </PageLayout>
          <p className="max-w-prose text-sm text-muted-foreground">
            The labelled rows in account details belong to its account-saving
            form and are not a reusable component. See them in{" "}
            <Link
              href="/account/details"
              className="inline-flex min-h-10 items-center text-primary underline-offset-4 hover:underline"
            >
              Account details
            </Link>
            .
          </p>
        </Section>

        <Section title="Brand and site navigation">
          <div className="flex flex-wrap items-center gap-4">
            <Logo />
            <Logo markOnly className="w-10 justify-center" />
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <LogoMark />
              Logo mark
            </span>
            <MobileMenu logo={<Logo className="-ml-2 px-2" />} />
          </div>
          <HeaderNav className="flex flex-wrap" />
          <SearchForm />
          <StaffBar user={{ role: admin.role }} />
          <StaffBar user={{ role: moderator.role }} />
          <p className="max-w-prose text-sm text-muted-foreground">
            The site header, footer, page backdrop and fixed mobile navigation
            already surround this page. Search, alerts, messages and the account
            menu are demonstrated in the header; member tools appear when signed
            in. They use the current session. The site accent and favicon apply
            to the whole document, so they are not repeated inside a demo.
          </p>
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Groups</CardTitle>
                <CardDescription>
                  Explore {admin.username}'s groups.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RoleBadge user={admin} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Awards</CardTitle>
                <CardDescription>With a footer row.</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                {member.username} has no awards at this time.
              </CardContent>
              <CardFooter className="justify-end">
                <Button variant="outline" size="sm">
                  View all
                </Button>
              </CardFooter>
            </Card>
          </div>
        </Section>

        <Section title="Avatars and users">
          <div className="flex flex-wrap items-end gap-5">
            {AVATAR_SIZES.map((size) => (
              <UserAvatar key={size} user={admin} size={size} />
            ))}
            <UserAvatar
              user={{ username: "guest", avatar: "" }}
              size="lg"
              link={false}
            />
          </div>
          <div className="flex flex-wrap items-end gap-5 pt-5">
            {AVATAR_SIZES.map((size) => (
              <UserAvatar
                key={size}
                user={{ ...member, appearance: { frame: "627" } }}
                size={size}
                link={false}
              />
            ))}
            <UserAvatar
              user={{
                username: "guest",
                avatar: "",
                appearance: { frame: "598" },
              }}
              size="lg"
              link={false}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {users.map((user) => (
              <UserAvatar key={user.id} user={user} size="lg" />
            ))}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {users.map((user) => (
              <UserLink key={user.id} user={user} />
            ))}
            <span className="flex items-center gap-2 text-muted-foreground">
              <SocialIcon network="discord" />
              <SocialIcon network="telegram" />
              <SocialIcon network="x" />
            </span>
          </div>
        </Section>

        <Section title="Stats">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Total Posts"
              icon={MessagesSquare}
              value={formatNumber(admin.postCount)}
            />
            <StatTile
              label="Total Reactions"
              icon={Heart}
              value={formatNumber(admin.reactionCount)}
            />
            <StatTile
              label="Followers"
              icon={Users}
              value={formatNumber(admin.followerCount)}
            />
            <StatTile
              label="Total Reputation"
              icon={Star}
              value={formatNumber(admin.reputation)}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <StatInline label="UID" value={admin.id} />
            <StatInline label="Posts" value={admin.postCount} />
            <StatInline label="Reactions" value={admin.reactionCount} />
            <StatInline label="Credits" value={formatCompact(admin.credits)} />
            <StatInline
              label="Reputation"
              value={formatNumber(admin.reputation)}
            />
            <StatInline label="Vouches" value={admin.vouches} />
          </div>
        </Section>

        <Section title="Reactions">
          <div className="-ml-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ReactionDemo types={reactionTypes} />
            <ReactionDemo types={reactionTypes} initial={reactionTypes[1].id} />
            <ReactionDemo types={reactionTypes} size="sm" />
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tap to like, tap again to remove. Hover, long-press or use the
            keyboard button after it to choose another reaction.
          </p>
          <div className="-ml-1 flex flex-wrap items-center gap-x-6 gap-y-1">
            <ReactionSummary reactions={reacted.reactions} />
            <ReactionSummary reactions={reacted.reactions} size="sm" />
          </div>
        </Section>

        <Section title="Awards and levels">
          <ul className="flex flex-wrap gap-2">
            {awards.map((award) => (
              <li key={award.id}>
                <AwardIcon award={award} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <AwardIcon award={awards[0]} size="sm" />
            <AwardIcon award={awards[0]} size="md" />
            <AwardIcon award={awards[0]} size="lg" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <AwardRow awards={admin.awards} />
            <AwardRow awards={moderator.awards} max={3} />
            <AwardRow awards={member.awards} size="md" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <LevelBadge level={admin.level} />
            <LevelBadge level={member.level} />
            <XpBar level={admin.level} />
            <XpBar level={moderator.level} label className="w-56" />
          </div>
          <div className="space-y-2">
            <UserStats user={admin} />
            <UserStats user={member} />
          </div>
        </Section>

        <Section title="Client icons">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            {BROWSERS.map((browser, index) => {
              const client = { browser, os: SYSTEMS[index] };
              return (
                <li key={browser} className="flex items-center gap-2">
                  <ClientIcons client={client} />
                  <span className="truncate text-muted-foreground">
                    {clientLabel(client)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Shop icons">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {SHOP_CATEGORIES.map((category) => (
              <li key={category} className="flex items-center gap-2">
                <ShopIcon category={category} className="size-4 shrink-0" />
                <span className="text-muted-foreground capitalize">
                  {category}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Permission icons">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {PERMISSIONS.map((permission) => (
              <li key={permission.key} className="flex items-center gap-2">
                <PermissionIcon
                  permission={permission}
                  className="size-4 shrink-0"
                />
                <span className="text-muted-foreground">
                  {permission.label}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Name colours">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            {Object.entries(NAME_COLORS).map(([key, color]) => (
              <li
                key={key}
                className={cn("flex items-center gap-2", color.text)}
              >
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", color.dot)}
                />
                {color.label}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Covers">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COVERS.slice(0, 3).map((cover, index) => {
              const variant = (["header", "full", "strip"] as const)[index];
              return (
                <li
                  key={cover.key}
                  className="relative isolate overflow-hidden rounded-lg border bg-card p-4"
                >
                  <CoverBackdrop cover={cover.key} variant={variant} />
                  <p className="text-sm font-semibold">
                    {cover.label}, {variant} variant
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    The cover sits behind the content and fades out, so text on
                    top of it keeps its contrast. A member without a cover gets
                    no backdrop.
                  </p>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Hover cards">
          <p className="max-w-prose text-sm text-muted-foreground">
            Thread links preview on hover and keyboard focus, and navigate on
            touch. A member name opens the same member card on hover, keyboard
            focus or tap; its View profile button opens the profile. Thread
            prefixes appear beside the title in both the link and its preview.
          </p>
          <div className="flex min-h-10 flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {stats.latestPosts.map((thread) => (
              <ThreadHoverCard
                key={thread.id}
                thread={thread}
                className="font-medium underline-offset-4 hover:underline"
              />
            ))}
            {prefixThread &&
              !stats.latestPosts.some(
                (thread) => thread.id === prefixThread.id,
              ) && (
                <ThreadHoverCard
                  thread={prefixThread}
                  className="font-medium underline-offset-4 hover:underline"
                />
              )}
            <UserLink user={admin} />
            <UserLink user={ranked[1] ?? member} />
          </div>
        </Section>

        <Section title="Members">
          <p className="max-w-prose text-sm text-muted-foreground">
            One member card is shared by the directory and member-name previews.
            A member&apos;s cover fades behind the header; LITE mode replaces it
            with a placeholder.
          </p>
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <MemberCard user={coveredMember ?? admin} />
            <SectionCard title="Member row">
              <MemberRow user={admin} />
              <MemberRow user={moderator}>
                <LevelBadge level={moderator.level} />
              </MemberRow>
            </SectionCard>
            <SectionCard
              title="Leaderboard"
              description="By XP, credits, posts, reactions, awards or referrals"
            >
              <Leaderboard
                members={users.slice(0, 3)}
                by="xp"
                viewerId={moderator.id}
              />
              <Leaderboard members={users.slice(0, 3)} by="credits" />
              <Leaderboard members={users.slice(0, 3)} by="posts" />
              <Leaderboard members={users.slice(0, 2)} by="reactions" />
              <Leaderboard members={users.slice(0, 2)} by="awards" />
              <Leaderboard members={users.slice(0, 2)} by="referrals" />
            </SectionCard>
          </div>
        </Section>

        <Section title="Podium and leaderboard variants">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <SectionCard
              title="Ranking podium"
              description="Top three, followed by compact rows"
            >
              <Podium members={leaders} by="xp" viewerId={leaders[1]?.id} />
            </SectionCard>
            <SectionCard
              title="Compact leaderboard"
              description="Continued ranks start at four"
            >
              <Leaderboard
                members={leaders.slice(3)}
                by="xp"
                start={4}
                compact
                viewerId={leaders[4]?.id}
              />
            </SectionCard>
          </div>
          <p className="text-sm text-muted-foreground">
            Rank numbers: medals, continued rank and a plain rank.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            {[1, 2, 3, 4].map((rank) => (
              <RankNumber key={rank} rank={rank} />
            ))}
            <RankNumber rank={1} medal={false} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {LEADERBOARD_KINDS.map((by) => (
              <SectionCard key={by} title={`Leaderboard score: ${by}`}>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <span className="text-xs text-muted-foreground">Full</span>
                  <LeaderboardScore by={by} member={leaders[0]} />
                </div>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <span className="text-xs text-muted-foreground">Compact</span>
                  <LeaderboardScore by={by} member={leaders[0]} compact />
                </div>
              </SectionCard>
            ))}
          </div>
        </Section>

        <Section title="Section card">
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <SectionCard
              title={categories[0].title}
              action={<Badge variant="outline">General</Badge>}
            >
              {categories[0].forums.map((forum) => (
                <div
                  key={forum.id}
                  className="flex min-h-14 items-center gap-3 px-4 py-2"
                >
                  <ForumIcon name={forum.icon} className="size-5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{forum.title}</span>
                      {forum.isNew && <Badge>New</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {forum.description}
                    </p>
                  </div>
                  <StatInline
                    label="Threads"
                    value={forum.threadCount}
                    className="items-center"
                  />
                </div>
              ))}
            </SectionCard>
            <SectionCard title="Your account" description="Sidebar variant">
              {["Your profile", "Notifications", "Bookmarks"].map((label) => (
                <Link
                  key={label}
                  href="#"
                  className="flex h-10 items-center px-4 text-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
            </SectionCard>
          </div>
        </Section>

        <Section title="Markdown">
          <div className="rounded-lg border bg-card p-4">
            <Markdown>{SAMPLE}</Markdown>
          </div>
        </Section>

        <Section title="Editor">
          <EditorDemo defaultValue={reacted.body} />
        </Section>

        <Section title="Compact composer">
          <CompactComposer
            action={discard}
            user={member}
            placeholder="What's on your mind?"
            submitLabel="Post"
            className="max-w-xl"
          />
        </Section>

        <Section title="Message row">
          <div className="max-w-xl divide-y divide-border overflow-hidden rounded-lg border bg-card">
            <MessageRow
              author={moderator}
              context={
                <>
                  posted on <UserLink user={admin} />
                  's profile
                </>
              }
              time={<RelativeTime date={sampleDate} />}
              actions={
                <>
                  <button
                    type="button"
                    aria-pressed
                    className={messageActionClass}
                  >
                    <Heart className="fill-current" />2
                  </button>
                  <button type="button" className={messageActionClass}>
                    <MessageCircle />1
                  </button>
                  <ShareButton href="/ui" className={messageActionClass} />
                </>
              }
              footer={
                <div className="mt-2 space-y-3 border-l pl-3">
                  <MessageRow
                    compact
                    author={admin}
                    time={<RelativeTime date={sampleDate} />}
                  >
                    <MessageBody className="text-[0.8125rem]">
                      A compact row, used for comments.
                    </MessageBody>
                  </MessageRow>
                  <CompactComposer
                    action={discard}
                    placeholder="Write a comment…"
                    submitLabel="Post comment"
                  />
                </div>
              }
            >
              <MessageBody>
                The horizontal row used by the feed, profile walls and comments.
              </MessageBody>
            </MessageRow>
            <MessageRow
              author={member}
              time={<RelativeTime date={sampleDate} />}
            >
              <MessageBody clamp>{SAMPLE}</MessageBody>
            </MessageRow>
          </div>
        </Section>

        <Section title="Notification and conversation rows">
          <p className="max-w-prose text-sm text-muted-foreground">
            The rows of the header panels and of the notifications and
            conversations pages. A conversation row brings its own link. Thread
            notifications keep the prefix beside the quoted title.
          </p>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
              {notifications.slice(0, 2).map((item, index) => (
                <li key={item.id}>
                  <NotificationRow item={item} size={index > 0 ? "lg" : "md"} />
                </li>
              ))}
            </ul>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
              {conversations.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href="/ui"
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <ConversationPreview
                      conversation={conversation}
                      viewerId={admin.id}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <UnreadDot />
            Unread dot
          </p>
        </Section>

        <Section title="Header panel">
          <p className="max-w-prose text-sm text-muted-foreground">
            A header icon that opens a panel under it. It closes on Escape, on a
            press outside and when a link inside is followed.
          </p>
          <HeaderPanel
            label="Sample panel"
            title="Alerts"
            unread={1}
            icon={<Bell />}
            className={headerIconClass}
          >
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {notifications.map((item) => (
                <li key={item.id}>
                  <NotificationRow item={item} />
                </li>
              ))}
            </ul>
          </HeaderPanel>
        </Section>

        <Section title="Empty state">
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={MessagesSquare}
              title="No threads yet"
              description="Be the first to start a discussion in this forum."
            >
              <Button>Start a thread</Button>
            </EmptyState>
          </div>
        </Section>

        <Section title="Credits amount">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
            <Credits value={250} className="text-sm" />
            <Credits value={admin.credits} className="text-base" />
            <Credits value={22000} className="text-2xl" />
          </div>
        </Section>

        <Section title="Art">
          <p className="max-w-prose text-sm text-muted-foreground">
            A decorative picture drawn as a background. The caller sizes the
            box, so the picture never moves the layout.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {awards.slice(0, 3).map((award) => (
              <li
                key={award.id}
                className="relative isolate flex aspect-video items-end overflow-hidden rounded-lg border bg-card p-3"
              >
                <Art
                  category="awards"
                  src={award.image}
                  className="absolute inset-0 -z-10"
                />
                <p className="text-sm font-semibold">{award.name}</p>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={liteText("title")}>
          <p className="max-w-prose text-sm text-muted-foreground">
            {liteText("description")}
          </p>
          <LiteMenuDemo state={lite} />
          <LiteSettingsForm
            key={serializeLiteCookie(lite)}
            state={lite}
            returnTo="/ui"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {liteText("artworkLabel")}
              </p>
              <LitePlaceholder className="aspect-video rounded-lg border" />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">
                {liteText("avatarLabel")}
              </p>
              <div className="flex items-center gap-4">
                <LitePlaceholder className="size-16 rounded-full" />
                <LitePlaceholder compact className="size-6 rounded-full" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Skeletons">
          <p className="max-w-prose text-sm text-muted-foreground">
            Loading regions announce progress once while their decorative shapes
            stay hidden from screen readers. Each shape reserves space for its
            content. Larger compositions start collapsed on phones; open a panel
            to preview them.
          </p>
          <SkeletonDemos />
        </Section>

        <Section title="Forum card and collapsible panel">
          <p className="max-w-prose text-sm text-muted-foreground">
            A forum with its photo: only the side the title sits on is darkened,
            and the last post has a plain footer. The panel remembers whether it
            was left open. The last-post title includes its thread prefix.
          </p>
          <CollapsiblePanel
            title={forumCategory.title}
            storageKey="styleguide-panel-open"
          >
            <ul className="grid gap-2 p-2 md:grid-cols-2">
              {forumCategory.forums.map((forum) => (
                <ForumCard key={forum.id} forum={forum} />
              ))}
            </ul>
          </CollapsiblePanel>
        </Section>

        <Section title="Member of the month">
          <p className="max-w-prose text-sm text-muted-foreground">
            The winner of a month, a standing with the leader set apart, and the
            compact list of earlier winners.
          </p>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
            {sampleWinner ? (
              <MonthHero winner={sampleWinner} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No recorded monthly winner to preview yet.
              </p>
            )}
            <div className="grid gap-4">
              <SectionCard title="Standing">
                <StandingList entries={race} viewerId={race[1]?.user.id} />
                {race.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No activity recorded this month.
                  </p>
                )}
              </SectionCard>
              <SectionCard title="Winners" description="Compact">
                <WinnerList winners={pastWinners} compact />
                {pastWinners.length === 0 && (
                  <p className="p-4 text-sm text-muted-foreground">
                    No earlier winners recorded.
                  </p>
                )}
              </SectionCard>
            </div>
          </div>
        </Section>

        <Section title="Thread cover controls">
          <p className="max-w-prose text-sm text-muted-foreground">
            What the author of a thread sees, then what staff see on a thread
            that is not theirs. This sample is not tied to a thread, so
            confirming reports an error.
          </p>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <CoverControls
              threadId={0}
              hasCover
              own
              covers={threadCovers.slice(0, 4)}
            />
            <CoverControls threadId={0} hasCover own={false} covers={[]} />
          </div>
        </Section>

        <Section title="Signature">
          <p className="max-w-prose text-sm text-muted-foreground">
            A member&apos;s signature under a post: small, muted, and cut off
            after its line limit. Line breaks are kept.
          </p>
          <div className="max-w-xl rounded-lg border bg-card p-4">
            <p className="text-sm">Thanks, that fixed it for me.</p>
            <Signature className="mt-3 border-t pt-2">
              {
                "*Measure twice, cut once.*\nCommissions are open: [see my threads](/forums)."
              }
            </Signature>
          </div>
        </Section>
      </PageLayout>
    </>
  );
}
