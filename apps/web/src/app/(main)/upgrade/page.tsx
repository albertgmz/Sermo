import { Check, ChevronDown, Coins, Crown, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { RankForm } from "@/app/(main)/upgrade/rank-form";
import { AwardIcon } from "@/components/forum/award-icon";
import { Credits } from "@/components/forum/credits";
import { LevelBadge, XpBar } from "@/components/forum/level";
import {
  CardSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { MemberBadge } from "@/components/forum/user-badges";
import { userNameProps } from "@/components/forum/user-name";
import { Container } from "@/components/layout/container";
import {
  heroSubtitleClass,
  heroTitleClass,
} from "@/components/layout/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AwardView,
  getAwards,
  getLeaderboard,
  getRanks,
  type RankView,
  type UserView,
} from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { DONOR_BADGE } from "@/lib/legacy-views";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("upgrade.upgrade");
  return {
    title: t("metaTitle"),
  };
}

const FAQ = [
  {
    question: "faq.purchaseQuestion",
    answer: "faq.purchaseAnswer",
  },
  {
    question: "faq.earnQuestion",
    answer: "faq.earnAnswer",
  },
  {
    question: "faq.upgradeQuestion",
    answer: "faq.upgradeAnswer",
  },
  {
    question: "faq.expiryQuestion",
    answer: "faq.expiryAnswer",
  },
  {
    question: "faq.donorQuestion",
    answer: "faq.donorAnswer",
  },
  {
    question: "faq.demoQuestion",
    answer: "faq.demoAnswer",
  },
] as const;

const floatingCardClass =
  "absolute rounded-xl border bg-card shadow-xl shadow-background/60";

const actionClass = "h-10 w-full";

type RankAward = AwardView | undefined;

function HeroArt({
  user,
  rank,
  award,
}: {
  user: UserView;
  rank: RankView;
  award: RankAward;
}) {
  const t = useTranslations("upgrade.upgrade");
  const rankName = userNameProps({ nameColor: rank.badge.color });
  const levels = useTranslations("lib.levels");
  const roles = useTranslations("lib.db.roles");
  const title =
    (can(user, "customTitle") && user.customTitle) ||
    (user.role === "member"
      ? levels(titleKeyForLevel(user.level.level))
      : roles(user.role));
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none relative hidden h-80 w-[26rem] shrink-0 select-none lg:block"
    >
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]" />
      {award && (
        <div
          className={cn(floatingCardClass, "top-0 right-0 w-64 rotate-3 p-4")}
        >
          <div className="flex items-center gap-3">
            <AwardIcon award={award} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{award.name}</p>
              <p className="text-xs text-tier-legendary">
                {t("exclusiveAward")}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="h-1.5 w-4/5 rounded-full bg-muted" />
            <div className="h-1.5 w-3/5 rounded-full bg-muted" />
          </div>
        </div>
      )}
      <div
        className={cn(floatingCardClass, "top-16 left-0 w-56 -rotate-6 p-4")}
      >
        <UserAvatar user={user.member} size="xl" link={false} />
        <p className="mt-3 flex items-center gap-1.5">
          <span
            className={cn("truncate text-base font-bold", rankName.className)}
            style={rankName.style}
          >
            {user.username}
          </span>
          <MemberBadge badge={rank.badge} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{title}</p>
        <div className="mt-3 flex items-center gap-2">
          <LevelBadge level={user.level} />
          <XpBar level={user.level} className="w-24" />
        </div>
      </div>
      <div
        className={cn(
          floatingCardClass,
          "right-4 bottom-12 flex -rotate-2 items-center gap-2 px-4 py-3",
        )}
      >
        <Coins className="size-5 text-primary" />
        <span className="text-sm font-bold">{t("paidWithCredits")}</span>
      </div>
      <div
        className={cn(
          floatingCardClass,
          "right-24 bottom-0 flex rotate-2 items-center gap-2 px-3 py-2 text-xs font-medium",
        )}
      >
        <Check className="size-3.5 text-success" />
        {t("lifetimePerks")}
      </div>
    </div>
  );
}

function Grant({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex min-h-8 items-center justify-between gap-3 text-sm">
      <span className="inline-flex shrink-0 items-center gap-2 text-muted-foreground">
        <Crown aria-hidden="true" className="size-3.5 text-tier-gold" />
        {label}
      </span>
      {children}
    </li>
  );
}

function Settled({
  children,
  note,
}: {
  children: React.ReactNode;
  note?: string;
}) {
  return (
    <div>
      <p className="flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium">
        {children}
      </p>
      <p className="mt-2 h-4 truncate text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function RankAction({
  rank,
  viewer,
  highlighted,
}: {
  rank: RankView;
  viewer: UserView | null;
  highlighted: boolean;
}) {
  const t = useTranslations("upgrade.upgrade");
  if (!viewer) {
    return (
      <div>
        <Link
          href="/login"
          className={cn(
            buttonVariants({ variant: highlighted ? "default" : "outline" }),
            actionClass,
          )}
        >
          {t("login")}
        </Link>
        <p className="mt-2 h-4 truncate text-xs text-muted-foreground">
          {t("paymentNote")}
        </p>
      </div>
    );
  }
  const current = viewer.rank;
  if (current?.id === rank.id) {
    return (
      <Settled note={t("currentRankNote")}>
        <Check aria-hidden="true" className="size-4 text-success" />
        {t("currentRank")}
      </Settled>
    );
  }
  if (current && current.price > rank.price) {
    return (
      <Settled note={t("includedNote", { rank: current.name })}>
        <Check aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("included")}
      </Settled>
    );
  }
  const cost = rank.price - (current?.price ?? 0);
  return (
    <RankForm
      rankId={rank.id}
      rankName={rank.name}
      cost={cost}
      missing={Math.max(0, cost - viewer.credits)}
      highlighted={highlighted}
    />
  );
}

function RankCard({
  rank,
  award,
  viewer,
  username,
  recommended,
}: {
  rank: RankView;
  award: RankAward;
  viewer: UserView | null;
  username: string;
  recommended: boolean;
}) {
  const t = useTranslations("upgrade.upgrade");
  const rankName = userNameProps({ nameColor: rank.badge.color });
  const current = viewer?.rank;
  const upgrading = current && current.price < rank.price;
  return (
    <li
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-4 md:p-5",
        recommended &&
          "border-primary/60 bg-[linear-gradient(to_bottom,color-mix(in_oklab,var(--primary)_10%,var(--card)),var(--card)_45%)] ring-1 ring-primary/25 lg:-my-3 lg:py-8",
      )}
    >
      {recommended && (
        <Badge className="absolute -top-2.5 left-1/2 -translate-x-1/2">
          {t("recommended")}
        </Badge>
      )}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xl font-bold tracking-tight">{rank.name}</h3>
        <div className="text-right">
          <p className="text-2xl leading-none tracking-tight">
            <Credits value={rank.price} />
          </p>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {upgrading
              ? t("upgradePrice", {
                  price: formatNumber(rank.price - current.price),
                  rank: current.name,
                })
              : t("priceNote")}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <RankAction rank={rank} viewer={viewer} highlighted={recommended} />
      </div>

      <ul className="mt-3">
        <Grant label={t("nameColorLabel")}>
          <span
            className={cn("min-w-0 truncate font-semibold", rankName.className)}
            style={rankName.style}
          >
            {username}
          </span>
        </Grant>
        {award && (
          <Grant label={t("awardLabel")}>
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {t("xp", { amount: formatNumber(award.xp) })}
              </span>
              <AwardIcon award={award} size="sm" className="size-6" />
            </span>
          </Grant>
        )}
        <Grant label={t("rankBadgeLabel")}>
          <MemberBadge badge={rank.badge} />
        </Grant>
      </ul>

      <hr className="my-4" />

      <ul className="space-y-2.5 text-sm">
        {rank.perks.map(({ label, included }) => (
          <li
            key={label}
            className={cn(
              "flex items-start gap-2.5",
              !included && "text-muted-foreground",
            )}
          >
            {included ? (
              <Check
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-success"
              />
            ) : (
              <X
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
            )}
            {t.rich(included ? "aria.included" : "aria.notIncluded", {
              status: (chunks) => <span className="sr-only">{chunks}</span>,
              label,
            })}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Donor({ viewer }: { viewer: UserView | null }) {
  const t = useTranslations("upgrade.upgrade");
  return (
    <section
      aria-labelledby="donor-title"
      className="grid gap-4 rounded-lg border border-dashed p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-8 md:p-5"
    >
      <div>
        <h2
          id="donor-title"
          className="flex items-center gap-2 text-base font-semibold"
        >
          {t("donorHeading")}
          <MemberBadge badge={DONOR_BADGE} />
          <span className="text-sm font-medium text-muted-foreground">
            {t("donorPrice")}
          </span>
        </h2>
        <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
          {t("donorDescription")}
        </p>
      </div>
      <div className="md:w-56">
        {viewer?.donor ? (
          <p className="flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium">
            <Check aria-hidden="true" className="size-4 text-success" />
            {t("donorThanks")}
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled
            className="h-10 w-full"
          >
            {t("donate")}
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground md:text-center">
          {t("donorNote")}
        </p>
      </div>
    </section>
  );
}

export default function UpgradePage() {
  const t = useTranslations("upgrade.upgrade");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingDetails")}>
            <Container className="flex items-center justify-between gap-10 py-12 md:py-20">
              <div className="w-full max-w-xl">
                <h1 className={heroTitleClass}>
                  {t.rich("heading", {
                    highlight: (chunks) => (
                      <span className="text-primary">{chunks}</span>
                    ),
                    br: () => <br />,
                  })}
                </h1>
                <p className={cn("mt-4 max-w-md", heroSubtitleClass)}>
                  {t("description")}
                </p>
                <Skeleton className="mt-5 h-20 w-full max-w-md" />
              </div>
              <Skeleton className="hidden size-72 shrink-0 lg:block" />
            </Container>
          </LoadingRegion>
        }
      >
        <UpgradeHero />
      </Suspense>
      <Container className="space-y-12 pb-8">
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingRanks")}>
              <div className="grid gap-6 md:grid-cols-3 md:gap-4">
                {[1, 2, 3].map((rank) => (
                  <CardSkeleton key={rank}>
                    <div className="space-y-6 p-6">
                      <Skeleton className="h-12 w-32" />
                      <TextSkeleton />
                      <div className="space-y-4">
                        {[1, 2, 3, 4, 5, 6].map((row) => (
                          <Skeleton key={row} className="h-5 w-full" />
                        ))}
                      </div>
                      <Skeleton className="h-10 w-full" />
                    </div>
                  </CardSkeleton>
                ))}
              </div>
            </LoadingRegion>
          }
        >
          <UpgradeRanks />
        </Suspense>
        <section aria-labelledby="faq-title">
          <h2
            id="faq-title"
            className="text-center text-2xl font-semibold tracking-tight"
          >
            {t("faqHeading")}
          </h2>
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
            {FAQ.map(({ question, answer }) => (
              <details key={question} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none -outline-offset-2 items-center justify-between gap-3 px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  {t(question)}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="px-4 pb-4 text-sm text-pretty text-muted-foreground">
                  {t(answer)}
                </p>
              </details>
            ))}
          </div>
        </section>
      </Container>
    </>
  );
}

async function UpgradeHero() {
  const t = await getTranslations("upgrade.upgrade");
  const [viewer, ranks, awards] = await Promise.all([
    getCurrentUser(),
    getRanks(),
    getAwards(),
  ]);
  const sample = viewer ?? (await getLeaderboard("xp", 1))[0];
  const awardOf = (rank: RankView) =>
    awards.find((award) => award.slug === rank.headline.award);
  const top = ranks[ranks.length - 1];

  return (
    <Container className="flex items-center justify-between gap-10 py-12 md:py-20">
      <div className="max-w-xl">
        <h1 className={heroTitleClass}>
          {t.rich("heading", {
            highlight: (chunks) => (
              <span className="text-primary">{chunks}</span>
            ),
            br: () => <br />,
          })}
        </h1>
        <p className={cn("mt-4 max-w-md", heroSubtitleClass)}>
          {t("description")}
        </p>
        <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm text-pretty">
          <Coins
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          <span>
            <span className="font-semibold">{t("earnedCredits")}</span>{" "}
            <span className="text-muted-foreground">
              {viewer
                ? t.rich("credits", {
                    count: viewer.credits,
                    amount: (chunks) => (
                      <span className="font-semibold text-foreground tabular-nums">
                        {chunks}
                      </span>
                    ),
                  })
                : t("guestCredits")}
            </span>
          </span>
        </p>
      </div>
      <HeroArt user={sample} rank={top} award={awardOf(top)} />
    </Container>
  );
}

async function UpgradeRanks() {
  const t = await getTranslations("upgrade.upgrade");
  const [viewer, ranks, awards] = await Promise.all([
    getCurrentUser(),
    getRanks(),
    getAwards(),
  ]);
  const awardOf = (rank: RankView) =>
    awards.find((award) => award.slug === rank.headline.award);
  const recommended = ranks[Math.floor(ranks.length / 2)];

  return (
    <section aria-labelledby="ranks-title" className="space-y-8">
      <h2 id="ranks-title" className="sr-only">
        {t("aria.ranks")}
      </h2>
      <ul className="grid gap-6 md:grid-cols-3 md:gap-4">
        {ranks.map((rank) => (
          <RankCard
            key={rank.id}
            rank={rank}
            award={awardOf(rank)}
            viewer={viewer}
            username={viewer?.username ?? t("usernamePlaceholder")}
            recommended={rank.id === recommended.id}
          />
        ))}
      </ul>
      <Donor viewer={viewer} />
    </section>
  );
}
