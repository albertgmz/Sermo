import { postsByAuthor } from "@sermo/core/contracts";
import { CalendarDays, Link2, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  getHeldAwards,
  type Profile,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { AwardIcon } from "@/components/forum/award-icon";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { SectionCard } from "@/components/forum/section-card";
import { SignatureHtml } from "@/components/forum/signature-html";
import {
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReferralField } from "@/components/widgets/referral-link";
import { formatNumber } from "@/lib/format";
import { profileTabPath } from "@/lib/profile-tabs";
import { read } from "@/lib/sermo/client";
import { prefixView } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

// The parts of a profile under its header: the level strip above the tab bar (the layout draws
// both), the cards beside or in a tab's panel, and the About tab's own card.

// How many posts the side card of recent activity lists.
const RECENT = 5;

// `address`: the profile's own path, the one the tabs are under.
export async function LevelStrip({
  profile,
  address,
}: {
  profile: Profile;
  address: string;
}) {
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
        href={`${profileTabPath(address, "about")}#awards`}
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

export function About({
  profile,
  isOwn,
  cards,
}: {
  profile: Profile;
  isOwn: boolean;
  cards: React.ReactNode;
}) {
  const t = useTranslations("members.profile");
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
            <StaticRelativeTime date={profile.createdAt} />
          </Detail>
          {isOwn && (
            <Detail icon={Link2} label={t("referralLabel")}>
              <ReferralField userId={profile.id} />
            </Detail>
          )}
        </dl>
      </SectionCard>
      {cards}
    </div>
  );
}

// The profile's cards, streamed in behind their placeholder.
export function StreamedCards({
  profile,
  className,
}: {
  profile: Profile;
  className?: string;
}) {
  const t = useTranslations("members.profile");
  return (
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
      <ProfileCards profile={profile} className={className} />
    </Suspense>
  );
}

// The panel of the wall, the posts and the threads: the tab's list, with the profile's cards beside
// it on a wide screen (a phone finds them on the About tab).
export function ProfilePanel({
  profile,
  children,
}: {
  profile: Profile;
  children: React.ReactNode;
}) {
  return (
    <PageLayout
      aside={<StreamedCards profile={profile} />}
      asideOnMobile="hidden"
    >
      {children}
    </PageLayout>
  );
}
