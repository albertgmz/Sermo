import { postsByAuthor } from "@sermo/core/contracts";
import { CalendarDays, Link2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { ActivityTab } from "@/app/[locale]/(main)/members/[id]/activity";
import {
  getHeldAwards,
  type Profile,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { Wall } from "@/app/[locale]/(main)/members/[id]/wall";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { AwardIcon } from "@/components/forum/award-icon";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { pageParam } from "@/components/forum/page-window";
import type { Query } from "@/components/forum/places";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { ShareButton } from "@/components/forum/share-button";
import { SignatureHtml } from "@/components/forum/signature-html";
import {
  FeedSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { Streamed } from "@/components/forum/streamed";
import { TabLinks } from "@/components/forum/tab-links";
import { UserBadges } from "@/components/forum/user-badges";
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
import { formatDate, formatNumber } from "@/lib/format";
import { canonicalPathOf } from "@/lib/sermo/addresses";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import type { getViewer } from "@/lib/sermo/session";
import { prefixView } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

// The sections of a profile under its header: the level strip, the tabs and the open tab's panel
// with the side cards. They are one part, which the tabs change in place (`TabSwitch`): the page
// draws it, and so does `profileSections` for a tab pressed.

const TABS = ["wall", "posts", "threads", "about"] as const;
type Tab = (typeof TABS)[number];

// The parameters of the address the tabs change in place.
export const PROFILE_TAB_PARAMS = ["tab"];

// How many posts the side card of recent activity lists.
const RECENT = 5;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

async function LevelStrip({ profile }: { profile: Profile }) {
  const locale = await getLocale();
  const [t, held] = await Promise.all([
    getTranslations("members.profile"),
    getHeldAwards(profile.id),
  ]);
  const { level } = profile;
  const bar = levelWithBounds(
    level.level,
    profile.awardXp,
    level.currentLevelXp,
    level.nextLevelXp,
  );
  const awards = held.items.reduce((sum, entry) => sum + entry.count, 0);
  return (
    <section
      aria-label={t("aria.level")}
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-4 py-3"
    >
      <LevelBadge level={bar} className="h-5 px-1.5 text-xs" />
      <XpBar level={bar} className="w-24 sm:w-64 lg:w-96" />
      <p className="text-xs tabular-nums text-muted-foreground">
        {t.rich("xp", {
          current: formatNumber(bar.xp, locale),
          next: formatNumber(bar.nextLevelXp, locale),
          value: (chunks) => (
            <span className="font-semibold text-foreground">{chunks}</span>
          ),
        })}
      </p>
      <Link
        href={`/members/${profile.id}?tab=about#awards`}
        className="relative ml-auto text-xs text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 hover:text-foreground"
      >
        {t.rich("awards", {
          count: awards,
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

async function ProfileCards({
  profile,
  className,
}: {
  profile: Profile;
  className?: string;
}) {
  const [t, held, recent] = await Promise.all([
    getTranslations("members.profile"),
    getHeldAwards(profile.id),
    read(postsByAuthor, { userId: profile.id, limit: RECENT }),
  ]);
  const user = () => <UserLink user={profile.card} />;
  return (
    <div className={cn("grid gap-4", className)}>
      <Card>
        <CardHeader>
          <CardTitle>{t("groupsHeading")}</CardTitle>
          <CardDescription>
            {t.rich("groupsDescription", {
              username: profile.username,
              user,
            })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {profile.card.badges.length > 0 ? (
            <UserBadges user={profile.card} limit={1} />
          ) : (
            <Badge variant="secondary">{profile.groupTitle}</Badge>
          )}
        </CardContent>
      </Card>
      <Card id="awards" className="scroll-mt-4">
        <CardHeader>
          <CardTitle>{t("awardsHeading")}</CardTitle>
          <CardDescription>
            {t.rich("awardsDescription", {
              username: profile.username,
              user,
            })}
          </CardDescription>
        </CardHeader>
        {held.items.length > 0 ? (
          <CardContent>
            <ul className="-m-1 flex flex-wrap">
              {held.items.map(({ award, count }) => (
                <li key={award.id} className="flex items-center">
                  <Link
                    href={`/awards/${award.id}`}
                    className="inline-flex size-10 items-center justify-center rounded-md transition-colors hover:bg-muted"
                  >
                    <AwardIcon
                      award={award}
                      label={
                        award.category
                          ? t("awardInCategory", {
                              name: award.name,
                              category: award.category.title,
                            })
                          : award.name
                      }
                    />
                  </Link>
                  {count > 1 && (
                    <span className="-ml-1.5 mr-1 text-xs text-muted-foreground tabular-nums">
                      {t("quantity", { count })}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-2 text-center text-muted-foreground">
            {t.rich("awardsEmpty", {
              username: profile.username,
              user,
            })}
          </CardContent>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("activityHeading")}</CardTitle>
          <CardDescription>
            {t.rich("activityDescription", {
              username: profile.username,
              user,
            })}
          </CardDescription>
        </CardHeader>
        {recent.items.length > 0 ? (
          <CardContent>
            <ul className="-my-2 divide-y">
              {recent.items.map(({ post, thread }) => {
                const prefix = prefixView(thread.prefix);
                return (
                  <li key={post.id}>
                    <Link
                      href={threadHref(thread.id, post.position, post.id)}
                      className="group flex min-h-12 flex-col justify-center py-2"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 font-medium underline-offset-4 group-hover:underline">
                        {prefix && <PrefixTag prefix={prefix} />}
                        <span className="truncate">{thread.title}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.rich(
                          post.position === 0
                            ? "activityStarted"
                            : "activityReplied",
                          {
                            time: () => <RelativeTime date={post.createdAt} />,
                          },
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        ) : (
          <CardContent className="py-2 text-center text-muted-foreground">
            {t.rich("activityEmpty", {
              username: profile.username,
              user,
            })}
          </CardContent>
        )}
      </Card>
    </div>
  );
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
      <dd className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function About({
  profile,
  isOwn,
  cards,
}: {
  profile: Profile;
  isOwn: boolean;
  cards: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("members.profile");
  const referral = `/register?ref=${profile.id}`;
  return (
    <div className="space-y-4">
      <SectionCard title={t("aboutHeading")}>
        <div className="px-4 py-3">
          {profile.about ? (
            // Plain text: React escapes it, the line breaks are kept.
            <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">
              {profile.about}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t.rich("bioEmpty", {
                username: profile.username,
                user: () => <UserLink user={profile.card} />,
              })}
            </p>
          )}
        </div>
        {profile.signatureHtml && (
          <div className="px-4 py-3">
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t("signatureHeading")}
            </h3>
            <SignatureHtml>{profile.signatureHtml}</SignatureHtml>
          </div>
        )}
        <dl className="divide-y divide-border">
          <Detail icon={CalendarDays} label={t("joinedLabel")}>
            {formatDate(profile.createdAt, locale)}
          </Detail>
          {isOwn && (
            <Detail icon={Link2} label={t("referralLabel")}>
              <span className="flex items-center gap-1">
                <Link
                  href={referral}
                  className="min-w-0 font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
                >
                  {referral}
                </Link>
                <ShareButton
                  href={referral}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground md:size-8 [&_svg]:size-4"
                />
              </span>
            </Detail>
          )}
        </dl>
      </SectionCard>
      {cards}
    </div>
  );
}

export async function ProfileSections({
  profile,
  query,
  viewer,
  inPlace = false,
}: {
  profile: Profile;
  query: Query;
  viewer: Awaited<ReturnType<typeof getViewer>>;
  inPlace?: boolean;
}) {
  const t = await getTranslations("members.profile");
  const tab: Tab = TABS.find((value) => value === query.tab) ?? "wall";
  const cards = (className?: string) => (
    <Streamed
      inPlace={inPlace}
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
      <ProfileCards profile={profile} className={className} />
    </Streamed>
  );

  return (
    <>
      <Streamed
        inPlace={inPlace}
        fallback={
          <LoadingRegion label={t("loadingSections")}>
            <Container className="pt-5">
              <Skeleton className="mb-4 h-12 w-full" />
              <TabsSkeleton />
            </Container>
          </LoadingRegion>
        }
      >
        <ProfileTabs profile={profile} tab={tab} />
      </Streamed>
      <div data-switch-panel="">
        {tab === "about" ? (
          <PageLayout>
            <About
              profile={profile}
              isOwn={viewer.user?.id === profile.id}
              cards={cards("md:grid-cols-2")}
            />
          </PageLayout>
        ) : (
          <PageLayout aside={cards()} asideOnMobile="hidden">
            <Streamed
              inPlace={inPlace}
              fallback={
                <LoadingRegion label={t("loadingActivity")}>
                  <FeedSkeleton />
                </LoadingRegion>
              }
            >
              <ProfileActivity
                profile={profile}
                tab={tab}
                cursor={first(query.cursor)}
                pages={query.pages}
                page={pageParam(query.page)}
                comments={first(query.comments)}
                commentsCursor={first(query.commentsCursor)}
                post={first(query.post)}
                comment={first(query.comment)}
              />
            </Streamed>
          </PageLayout>
        )}
      </div>
    </>
  );
}

async function ProfileTabs({ profile, tab }: { profile: Profile; tab: Tab }) {
  const t = await getTranslations("members.profile");
  const base = canonicalPathOf(profile.seo.canonical);
  const tabs = [
    { value: "wall", label: t("wallTab"), href: base },
    {
      value: "posts",
      label: t("postsTab"),
      href: `${base}?tab=posts`,
      count: profile.postCount,
    },
    { value: "threads", label: t("threadsTab"), href: `${base}?tab=threads` },
    { value: "about", label: t("aboutTab"), href: `${base}?tab=about` },
  ];

  return (
    <Container className="pt-5">
      <LevelStrip profile={profile} />
      <TabLinks tabs={tabs} active={tab} label={t("aria.sections")} />
    </Container>
  );
}

function ProfileActivity({
  profile,
  tab,
  cursor,
  pages,
  page,
  comments,
  commentsCursor,
  post,
  comment,
}: {
  profile: Profile;
  tab: Tab;
  cursor?: string;
  pages?: string | string[];
  page: number;
  comments?: string;
  commentsCursor?: string;
  post?: string;
  comment?: string;
}) {
  const postId = Number(comments);
  const focusId = parseId(post ?? "");
  const commentId = parseId(comment ?? "");
  if (tab === "posts" || tab === "threads") {
    return <ActivityTab tab={tab} profile={profile} page={page} />;
  }
  return (
    <Wall
      profile={profile}
      cursor={cursor}
      pages={pages}
      open={
        Number.isSafeInteger(postId) && postId > 0
          ? { postId, cursor: commentsCursor }
          : undefined
      }
      focus={
        focusId === null
          ? undefined
          : { postId: focusId, commentId: commentId ?? undefined }
      }
    />
  );
}
