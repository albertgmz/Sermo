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
import { LiteSettingsForm } from "@/app/(main)/lite/settings-form";
import { discard, discardLine } from "@/app/(main)/ui/actions";
import { EditorDemo } from "@/app/(main)/ui/editor-demo";
import { LiteMenuDemo } from "@/app/(main)/ui/lite-menu-demo";
import { MemberActionsDemo } from "@/app/(main)/ui/member-actions-demo";
import { ReactionDemo } from "@/app/(main)/ui/reaction-demo";
import { SkeletonDemos } from "@/app/(main)/ui/skeleton-demos";
import { StaffDemos } from "@/app/(main)/ui/staff-demos";
import { Art } from "@/components/forum/art";
import { AttachmentField } from "@/components/forum/attachment-field";
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
import { HtmlContent } from "@/components/forum/html-content";
import { LazyEditor } from "@/components/forum/lazy-editor";
import {
  Leaderboard,
  LeaderboardScore,
  RankNumber,
} from "@/components/forum/leaderboard";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { LineComposer } from "@/components/forum/line-composer";
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
import { PostFrame } from "@/components/forum/post-frame";
import { Postbit } from "@/components/forum/postbit";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { ReactionSummary } from "@/components/forum/reaction-summary";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { ShareButton } from "@/components/forum/share-button";
import { SHOP_EFFECT_TYPES, ShopIcon } from "@/components/forum/shop-icon";
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
import { MemberBadge, UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { UserStats } from "@/components/forum/user-stats";
import { WallComments } from "@/components/forum/wall-comments";
import { IconPicker } from "@/components/icons/icon-picker";
import { headerIconClass } from "@/components/layout/header-icon-class";
import { HeaderPanel } from "@/components/layout/header-panel";
import { Logo, LogoMark } from "@/components/layout/logo";
import { NarrowToggle } from "@/components/layout/narrow-toggle";
import { toNavItems } from "@/components/layout/nav";
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
import type { Browser, Os } from "@/lib/client";
import {
  formatCompact,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
} from "@/lib/format";
import { getLiteState } from "@/lib/lite-mode";
import { blocks, serializeLiteCookie } from "@/lib/lite-preferences";
import { NOINDEX } from "@/lib/sermo/seo";
import { cn } from "@/lib/utils";
import {
  ACCENTS,
  ADMIN,
  AWARDS,
  BADGES,
  CONVERSATIONS,
  COVERED_CARD,
  COVERS,
  FORUMS,
  FRAME_OF_GUEST,
  FRAMED,
  GUEST,
  LEADERS,
  LEVEL_HALF,
  LEVEL_NEW,
  LEVEL_START,
  MEMBER,
  MEMBERS,
  MODERATOR,
  memberOf,
  NAME_COLORS,
  NAME_ICONS,
  NEWCOMER,
  NOTIFICATIONS,
  PERMISSION_ICONS,
  PLAIN_AUTHOR,
  PLAIN_CARD,
  PREFIXES,
  REACTION_PICTURE_TYPES,
  REACTION_TYPES,
  REACTIONS,
  RELATION,
  RESTRICTED_AUTHOR,
  SAMPLE_AUTHOR,
  SAMPLE_COUNTS,
  SAMPLE_DATE,
  SAMPLE_WALL_COMMENTS,
  STANDING,
  THREADS,
  WINNERS,
} from "./samples";

export const metadata: Metadata = {
  title: "Styleguide",
  robots: NOINDEX,
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
  "border",
  "input",
  "ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
];

// Hand-built samples of the shapes the shared components draw.
// The entries a site ships with; a real site reads them from the navigation.
const NAV_SAMPLES = toNavItems(
  [
    ["header.home", "Home", "/"],
    ["header.forums", "Forums", "/forums"],
    ["header.members", "Members", "/members"],
    ["header.awards", "Awards", "/awards"],
    ["header.credits", "Credits", "/credits"],
  ].map(([builtin, title, target], id) => ({
    id,
    title,
    target,
    builtin,
    icon: null,
    iconPosition: "before" as const,
    children: [],
  })),
);

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

// Sample HTML as the backend writes a mention.
const MENTION_HTML = `<p>Thanks <a href="/members/${ADMIN.id}" class="mention" data-user-id="${ADMIN.id}">@${ADMIN.username}</a> for the help.</p>`;

export default async function StyleguidePage() {
  const [lite, liteText] = await Promise.all([
    getLiteState(),
    getTranslations("lite.page.demo"),
  ]);
  // Sample pictures meet LITE here, as the pages do through the reactions seam.
  const pictureTypes = blocks(lite, "reactions")
    ? REACTION_PICTURE_TYPES.map((type) => ({ ...type, picture: null }))
    : REACTION_PICTURE_TYPES;
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

        <Section title="Accents">
          <p className="max-w-prose text-sm text-muted-foreground">
            A site offers a palette of accents and a member picks one; the
            choice sets <code>--primary</code> and its text colour on the root
            of the document. These previews set them on a subtree.
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ACCENTS.map((accent) => (
              <li
                key={accent.label}
                style={
                  {
                    "--primary": accent.color,
                    "--primary-foreground": accent.foreground,
                    "--ring": accent.color,
                  } as React.CSSProperties
                }
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

        <Section title="Narrow layout toggle">
          <p className="max-w-prose text-sm text-muted-foreground">
            The header button that narrows the page to 1100px. The choice is
            kept in the visitor's browser only. It is hidden below 1100px, where
            the page is not wider than the narrow width anyway, so it shows here
            only on a wide window.
          </p>
          <div className="flex items-center gap-2">
            <NarrowToggle />
          </div>
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
              Caption: {formatDateTime(SAMPLE_DATE)} ·{" "}
              {formatRelativeTime(SAMPLE_DATE)} · {formatDate(SAMPLE_DATE)} ·{" "}
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
              { label: "General", href: "/forums" },
              { label: FORUMS[1].title },
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
            {BADGES.map((badge) => (
              <MemberBadge key={badge.label} badge={badge} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {PREFIXES.map((prefix) => (
              <PrefixTag key={prefix.id} prefix={prefix} />
            ))}
            <PrefixTag prefix={PREFIXES[0]} icon={false} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {MEMBERS.map((member) => (
              <span
                key={member.id}
                className="inline-flex items-center gap-1.5"
              >
                <UserLink user={member} className="text-sm" />
                <UserBadges user={member} />
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

        <Section title="Icon picker">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label id="sg-icon-none-label" htmlFor="sg-icon-none">
                No icon chosen
              </Label>
              <IconPicker
                name="icon-none"
                id="sg-icon-none"
                labelId="sg-icon-none-label"
              />
            </div>
            <div className="space-y-2">
              <Label id="sg-icon-set-label" htmlFor="sg-icon-set">
                An icon chosen
              </Label>
              <IconPicker
                name="icon-set"
                id="sg-icon-set"
                labelId="sg-icon-set-label"
                defaultValue="gamepad-2"
              />
            </div>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Choose one icon of the site's set, or none. The choice travels in a
            hidden input named by the name prop; read it in a server action,
            where an empty value means none. The set lives in
            components/icons/icon-set.ts.
          </p>
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

        <Section title="Account navigation">
          <p className="max-w-prose text-sm text-muted-foreground">
            Account sections scroll within their bar on small screens and become
            a grouped sidebar on desktop. These links open the real sections. On
            this page, the account menu has no active section. The
            administration panel&apos;s navigation is shown with the panel
            pieces below.
          </p>
          <PageLayout
            aside={<AccountNavigation />}
            asideSide="start"
            className="px-0 pt-0 pb-0"
          >
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
              The page content sits beside the navigation.
            </p>
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
            <MobileMenu
              links={NAV_SAMPLES}
              logo={<Logo className="-ml-2 px-2" />}
            />
          </div>
          <HeaderNav links={NAV_SAMPLES} className="flex flex-wrap" />
          <SearchForm />
          <StaffBar admin moderation pending={{ count: 3, more: false }} />
          <StaffBar admin={false} moderation />
          <p className="max-w-prose text-sm text-muted-foreground">
            The site header, footer, page backdrop and fixed mobile navigation
            already surround this page. Search, alerts, messages and the account
            menu are demonstrated in the header; member tools appear when signed
            in. They use the current session. The site accent and favicon apply
            to the whole document, so they are not repeated inside a demo.
          </p>
        </Section>

        <Section title="Administration panel">
          <StaffDemos />
        </Section>

        <Section title="Cards">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Groups</CardTitle>
                <CardDescription>
                  Explore {ADMIN.username}'s groups.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <MemberBadge badge={BADGES[0]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Awards</CardTitle>
                <CardDescription>With a footer row.</CardDescription>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                {MEMBER.username} has no awards at this time.
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
              <UserAvatar key={size} user={ADMIN} size={size} />
            ))}
            <UserAvatar user={GUEST} size="lg" link={false} />
          </div>
          <div className="flex flex-wrap items-end gap-5 pt-5">
            {AVATAR_SIZES.map((size) => (
              <UserAvatar key={size} user={FRAMED} size={size} link={false} />
            ))}
            <UserAvatar
              user={{ ...GUEST, frame: FRAME_OF_GUEST }}
              size="lg"
              link={false}
            />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {MEMBERS.map((member) => (
              <UserAvatar key={member.id} user={member} size="lg" />
            ))}
          </div>
          <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {MEMBERS.map((member) => (
              <UserLink key={member.id} user={member} />
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
              value={formatNumber(SAMPLE_COUNTS.postCount)}
            />
            <StatTile
              label="Total Reactions"
              icon={Heart}
              value={formatNumber(SAMPLE_COUNTS.reactionCount)}
            />
            <StatTile
              label="Followers"
              icon={Users}
              value={formatNumber(SAMPLE_COUNTS.followerCount)}
            />
            <StatTile
              label="Total Reputation"
              icon={Star}
              value={formatNumber(SAMPLE_COUNTS.reputation)}
            />
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            <StatInline label="UID" value={ADMIN.id} />
            <StatInline label="Posts" value={SAMPLE_COUNTS.postCount} />
            <StatInline label="Reactions" value={SAMPLE_COUNTS.reactionCount} />
            <StatInline
              label="Credits"
              value={formatCompact(SAMPLE_COUNTS.credits)}
            />
            <StatInline
              label="Reputation"
              value={formatNumber(SAMPLE_COUNTS.reputation)}
            />
            <StatInline label="Referrals" value={SAMPLE_COUNTS.referralCount} />
          </div>
        </Section>

        <Section title="Reactions">
          <div className="-ml-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ReactionDemo
              types={REACTION_TYPES}
              others={REACTIONS.total}
              summary={
                <ReactionSummary reactions={REACTIONS} showTotal={false} />
              }
            />
            <ReactionDemo
              types={REACTION_TYPES}
              others={REACTIONS.total}
              summary={
                <ReactionSummary reactions={REACTIONS} showTotal={false} />
              }
              initial={REACTION_TYPES[1].id}
            />
            <ReactionDemo
              types={REACTION_TYPES}
              others={REACTIONS.total}
              summary={
                <ReactionSummary
                  reactions={REACTIONS}
                  size="sm"
                  showTotal={false}
                />
              }
              size="sm"
            />
            <ReactionDemo
              types={REACTION_TYPES}
              others={REACTIONS.total}
              summary={<ReactionSummary reactions={REACTIONS} />}
              own
            />
            <ReactionDemo types={REACTION_TYPES} others={0} summary={null} />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xl">
            {[REACTION_TYPES[0], ...pictureTypes].map((type) => (
              <span
                key={type.id}
                className="inline-flex items-center gap-2 text-sm text-muted-foreground"
              >
                <ReactionPicture
                  emoji={type.emoji}
                  picture={type.picture}
                  label={type.label}
                  className="text-xl"
                />
                {type.label}
              </span>
            ))}
          </div>
          <div className="-ml-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <ReactionDemo
              types={[...REACTION_TYPES.slice(0, 2), ...pictureTypes]}
              others={0}
              summary={null}
              initial={pictureTypes[1].id}
            />
          </div>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tap to like, tap again to remove. Hover, long-press or use the
            keyboard button after it to choose another reaction. The number is
            shown once; the emojis beside it open who reacted. On your own item
            there is nothing to press and the summary shows the number. A
            reaction can carry a picture instead of its emoji: a plain image is
            drawn whole, a sprite sheet steps through its frames (still with
            reduced motion), and where LITE blocks the category the emoji is
            drawn.
          </p>
        </Section>

        <Section title="Awards and levels">
          <ul className="flex flex-wrap gap-2">
            {AWARDS.map((award) => (
              <li key={award.id}>
                <AwardIcon award={award} />
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <AwardIcon award={AWARDS[0]} size="sm" />
            <AwardIcon award={AWARDS[0]} size="md" />
            <AwardIcon award={AWARDS[0]} size="lg" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <AwardRow awards={AWARDS} />
            <AwardRow awards={AWARDS} max={3} />
            <AwardRow awards={AWARDS.slice(0, 3)} size="md" />
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <LevelBadge level={ADMIN} />
            <LevelBadge level={MEMBER} />
            <XpBar level={LEVEL_START} />
            <XpBar level={LEVEL_HALF} label className="w-56" />
          </div>
          <div className="space-y-2">
            <UserStats
              user={{ level: LEVEL_HALF, postCount: 1280, reactionCount: 940 }}
            />
            <UserStats
              user={{ level: LEVEL_NEW, postCount: 12, reactionCount: 3 }}
            />
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

        <Section title="Address target">
          <p className="text-sm text-muted-foreground">
            When the address names an element (<code>#post-12</code>,{" "}
            <code>#profile-post-3</code>, <code>#profile-comment-9</code>,{" "}
            <code>#message-4</code>), it is brought into view and the rest of
            the page is dimmed for a few seconds. A scroll, a click or a key
            press takes the dimming away at once. The component is mounted once
            in the site frame; this link follows an address on this page.
          </p>
          <a
            href="#post-0"
            className="inline-flex h-10 items-center text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Go to the sample post
          </a>
          <div
            id="post-0"
            className="scroll-mt-4 rounded-lg border bg-card p-4 text-sm"
          >
            Sample post. The dimming follows its edges.
          </div>
        </Section>

        <Section title="Shop icons">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {SHOP_EFFECT_TYPES.map((type) => (
              <li key={type} className="flex items-center gap-2">
                <ShopIcon type={type} className="size-4 shrink-0" />
                <span className="text-muted-foreground">{type}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Permission icons">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {PERMISSION_ICONS.map((permission) => (
              <li key={permission.icon} className="flex items-center gap-2">
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
            {NAME_COLORS.map(({ label, color }) => (
              <li key={label} className="flex items-center gap-2">
                <UserLink
                  user={{ ...NEWCOMER, username: label, nameColor: color }}
                />
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Name icons">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
            {NAME_ICONS.map(({ label, icon, position, color }) => (
              <li key={label} className="flex items-center gap-2">
                <UserLink
                  user={{
                    ...NEWCOMER,
                    username: label,
                    nameColor: color,
                    nameIcon: { icon, position },
                  }}
                />
              </li>
            ))}
            <li className="flex items-center gap-2">
              <UserLink
                user={{
                  ...NEWCOMER,
                  username: "unknown key",
                  nameIcon: { icon: "not-in-the-set", position: "before" },
                }}
              />
            </li>
          </ul>
        </Section>

        <Section title="Covers">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {COVERS.map((cover, index) => {
              const variant = (["header", "full", "strip"] as const)[index];
              return (
                <li
                  key={cover.label}
                  className="relative isolate overflow-hidden rounded-lg border bg-card p-4"
                >
                  <CoverBackdrop cover={cover.picture} variant={variant} />
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
            touch. A member avatar, a member name and an @mention open the
            member card (the postbit with its actions) on hover or keyboard
            focus; on touch and pen a tap goes to the profile. The name and
            avatar inside the card, or inside a post's own postbit, are plain
            links. Thread prefixes appear beside the title in both the link and
            its preview.
          </p>
          <div className="flex min-h-10 flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            {THREADS.map((thread) => (
              <ThreadHoverCard
                key={thread.id}
                thread={thread}
                className="font-medium underline-offset-4 hover:underline"
              />
            ))}
            <UserAvatar user={ADMIN} size="lg" />
            <UserLink user={ADMIN} />
            <UserLink user={MODERATOR} />
            <HtmlContent className="text-sm">{MENTION_HTML}</HtmlContent>
          </div>
        </Section>

        <Section title="Members">
          <p className="max-w-prose text-sm text-muted-foreground">
            One member card is shared by the members directory. A member&apos;s
            cover fades behind the header; LITE mode replaces it with a
            placeholder.
          </p>
          <div className="grid gap-4 lg:grid-cols-3 lg:items-start">
            <MemberCard user={COVERED_CARD} />
            <MemberCard user={PLAIN_CARD} />
            <SectionCard title="Member row">
              <MemberRow user={ADMIN} badgeLimit={1} />
              <MemberRow user={MODERATOR} badgeLimit={1}>
                <LevelBadge level={MODERATOR} />
              </MemberRow>
            </SectionCard>
            <SectionCard
              title="Leaderboard"
              description="By XP, credits, posts, reactions, awards or referrals"
            >
              <Leaderboard
                members={LEADERS.slice(0, 3)}
                by="xp"
                viewerId={MODERATOR.id}
              />
              <Leaderboard members={LEADERS.slice(0, 3)} by="credits" />
              <Leaderboard members={LEADERS.slice(0, 3)} by="posts" />
              <Leaderboard members={LEADERS.slice(0, 2)} by="reactions" />
              <Leaderboard members={LEADERS.slice(0, 2)} by="awards" />
              <Leaderboard members={LEADERS.slice(0, 2)} by="referrals" />
            </SectionCard>
          </div>
        </Section>

        <Section title="Postbit and post frame">
          <p className="max-w-prose text-sm text-muted-foreground">
            The author of a post: a column from the medium breakpoint up, a
            compact header on a phone. Threads and conversations draw their
            posts through one frame.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 sm:items-start">
            <SectionCard title="Column">
              <Postbit
                author={SAMPLE_AUTHOR}
                layout="column"
                className="p-3"
                actions={
                  <MemberActionsDemo
                    member={SAMPLE_AUTHOR.member}
                    relation={RELATION.notFollowing}
                    form="labelled"
                  />
                }
              />
            </SectionCard>
            <SectionCard title="Column, plain member">
              <Postbit author={PLAIN_AUTHOR} layout="column" className="p-3" />
            </SectionCard>
            <SectionCard title="Column, restricted member">
              <Postbit
                author={RESTRICTED_AUTHOR}
                layout="column"
                className="p-3"
              />
            </SectionCard>
            <SectionCard title="Responsive, with actions">
              <Postbit
                author={SAMPLE_AUTHOR}
                className="p-3"
                actions={
                  <MemberActionsDemo
                    member={SAMPLE_AUTHOR.member}
                    relation={RELATION.following}
                  />
                }
              />
            </SectionCard>
            <SectionCard
              title="Member actions"
              description="Follow or unfollow in place, and start a private conversation. Each only when allowed; nothing for a guest, yourself or a restricted member."
            >
              <div className="grid gap-3 p-3">
                {(
                  [
                    ["Not following", RELATION.notFollowing],
                    ["Following", RELATION.following],
                    ["Message only", RELATION.messageOnly],
                    ["None", RELATION.none],
                  ] as const
                ).map(([label, relation]) => (
                  <div key={label} className="grid gap-1.5">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <MemberActionsDemo
                      member={SAMPLE_AUTHOR.member}
                      relation={relation}
                      form="labelled"
                    />
                    <MemberActionsDemo
                      member={SAMPLE_AUTHOR.member}
                      relation={relation}
                      form="compact"
                    />
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Compact header">
              <Postbit
                author={SAMPLE_AUTHOR}
                layout="compact"
                className="p-3"
              />
              <Postbit
                author={PLAIN_AUTHOR}
                layout="compact"
                className="border-t p-3"
              />
            </SectionCard>
          </div>
          <SectionCard title="Post frame">
            <PostFrame
              id="sample-post"
              author={SAMPLE_AUTHOR}
              createdAt={SAMPLE_DATE}
              signed
              actions={<Button variant="ghost">Reply</Button>}
            >
              <p className="mt-2 text-sm">
                A post as a thread draws it. Resize the window to see the column
                become a header above the text.
              </p>
            </PostFrame>
          </SectionCard>
        </Section>

        <Section title="Podium and leaderboard variants">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <SectionCard
              title="Ranking podium"
              description="Top three, followed by compact rows"
            >
              <Podium members={LEADERS} by="xp" viewerId={LEADERS[1].card.id} />
            </SectionCard>
            <SectionCard
              title="Compact leaderboard"
              description="Continued ranks start at four"
            >
              <Leaderboard
                members={LEADERS.slice(3)}
                by="xp"
                start={4}
                compact
                viewerId={LEADERS[4].card.id}
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
                  <LeaderboardScore by={by} member={LEADERS[0]} />
                </div>
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <span className="text-xs text-muted-foreground">Compact</span>
                  <LeaderboardScore by={by} member={LEADERS[0]} compact />
                </div>
              </SectionCard>
            ))}
          </div>
        </Section>

        <Section title="Section card">
          <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
            <SectionCard
              title={FORUMS[0].title}
              action={<Badge variant="outline">General</Badge>}
            >
              {FORUMS.map((forum) => (
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
          <EditorDemo defaultValue={SAMPLE} />
        </Section>

        <Section title="Compact composer">
          <CompactComposer
            action={discard}
            user={MEMBER}
            placeholder="What's on your mind?"
            submitLabel="Post"
            className="max-w-xl"
          />
        </Section>

        <Section title="Lazy editor">
          <p className="text-sm text-muted-foreground">
            A one-line box that loads the editor, with its formatting bar, when
            it is entered. Used by the wall, comment and conversation composers.
          </p>
          <LazyEditor
            name="body"
            placeholder="Write a message…"
            className="max-w-xl"
          />
        </Section>

        <Section title="Line composer">
          <p className="text-sm text-muted-foreground">
            The lazy editor with its send button, for answering where the item
            is read: a comment on a wall post, a reply from a feed card. A
            refusal is shown under the line.
          </p>
          <LineComposer
            action={discardLine}
            placeholder="Write a reply…"
            submitLabel="Post reply"
            className="max-w-xl"
          />
        </Section>

        <Section title="Wall comments">
          <p className="text-sm text-muted-foreground">
            The comments under a wall post, the links to the rest of them and
            the composer for the next one. Drawn by the profile wall and by the
            feed's wall-post cards.
          </p>
          <div className="max-w-xl rounded-lg border bg-card p-4">
            <WallComments
              anchor="sample-wall-post"
              comments={SAMPLE_WALL_COMMENTS}
              links={{ more: "/ui" }}
              action={discardLine}
              member={memberOf}
              viewerId={null}
              picker={[]}
              reactionTypes={[]}
              className="mt-0"
            />
          </div>
        </Section>

        <Section title="Attachment field, compact">
          <p className="text-sm text-muted-foreground">
            The paperclip alone, for a composer's own row: the chosen files take
            a line before it and scroll once they are many.
          </p>
          <div className="flex max-w-xl flex-wrap items-end gap-2">
            <AttachmentField compact />
            <LazyEditor
              name="message"
              placeholder="Write a message…"
              className="flex-1 rounded-4xl"
            />
          </div>
        </Section>

        <Section title="Message row">
          <div className="max-w-xl divide-y divide-border overflow-hidden rounded-lg border bg-card">
            <MessageRow
              author={MODERATOR}
              context={
                <>
                  posted on <UserLink user={ADMIN} />
                  's profile
                </>
              }
              time={<RelativeTime date={SAMPLE_DATE} />}
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
                    author={ADMIN}
                    time={<RelativeTime date={SAMPLE_DATE} />}
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
              author={MEMBER}
              time={<RelativeTime date={SAMPLE_DATE} />}
            >
              <MessageBody clamp>{SAMPLE}</MessageBody>
            </MessageRow>
          </div>
        </Section>

        <Section title="Notification and conversation rows">
          <p className="max-w-prose text-sm text-muted-foreground">
            The rows of the header panels and of the notifications and
            conversations pages. A conversation row brings its own link. A
            notification names its actors, three at most by name, and its text
            comes from the type the backend sent.
          </p>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
              {NOTIFICATIONS.map(({ item, href, emoji }, index) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    href={href}
                    emoji={emoji}
                    member={memberOf}
                    size={index > 0 ? "lg" : "md"}
                  />
                </li>
              ))}
            </ul>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
              {CONVERSATIONS.map((conversation) => (
                <li key={conversation.id}>
                  <Link
                    href="/ui"
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <ConversationPreview
                      conversation={conversation}
                      member={MODERATOR}
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
              {NOTIFICATIONS.map(({ item, href, emoji }) => (
                <li key={item.id}>
                  <NotificationRow
                    item={item}
                    href={href}
                    emoji={emoji}
                    member={memberOf}
                  />
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
            <Credits value={SAMPLE_COUNTS.credits} className="text-base" />
            <Credits value={22000} className="text-2xl" />
          </div>
        </Section>

        <Section title="Art">
          <p className="max-w-prose text-sm text-muted-foreground">
            A decorative picture drawn as a background. The caller sizes the
            box, so the picture never moves the layout.
          </p>
          <ul className="grid gap-3 sm:grid-cols-3">
            {AWARDS.slice(3, 6).map((award) => (
              <li
                key={award.id}
                className="relative isolate flex aspect-video items-end overflow-hidden rounded-lg border bg-card p-3"
              >
                <Art
                  category="awards"
                  src={award.image?.url ?? ""}
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
          <CollapsiblePanel title="General" storageKey="styleguide-panel-open">
            <ul className="grid gap-2 p-2 md:grid-cols-2">
              {FORUMS.map((forum) => (
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
            <MonthHero winner={WINNERS[0]} />
            <div className="grid gap-4">
              <SectionCard title="Standing">
                <StandingList
                  entries={STANDING}
                  viewerId={STANDING[1].card.id}
                />
              </SectionCard>
              <SectionCard title="Winners" description="Compact">
                <WinnerList winners={WINNERS.slice(1)} compact />
              </SectionCard>
            </div>
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
