import { Check, ChevronDown, Coins, Crown, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RankForm } from "@/app/(main)/upgrade/rank-form";
import { AwardIcon } from "@/components/forum/award-icon";
import { Credits } from "@/components/forum/credits";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { DonorBadge, RankBadge } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { Container } from "@/components/layout/container";
import {
  heroSubtitleClass,
  heroTitleClass,
} from "@/components/layout/page-hero";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { nameColor } from "@/lib/appearance";
import {
  type AwardView,
  getAwards,
  getLeaderboard,
  getRanks,
  type UserView,
} from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";
import type { Rank } from "@/lib/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Upgrade - forum/ui",
};

const FAQ = [
  {
    question: "Can I buy a rank with money?",
    answer:
      "No. Ranks are bought with credits only, and credits cannot be purchased. Nobody gets ahead here by paying.",
  },
  {
    question: "How do I earn credits?",
    answer:
      "By taking part: visiting every day, starting threads, replying, receiving reactions, keeping a weekly streak and earning awards. The credits page lists every way to earn.",
  },
  {
    question: "Can I move to a higher rank later?",
    answer:
      "You can. You only pay the difference in credits between your current rank and the new one, and you keep the award and the name colour you already unlocked.",
  },
  {
    question: "Does a rank expire?",
    answer:
      "No. A rank is bought once and stays with your account, together with everything it unlocks.",
  },
  {
    question: "What is Donor?",
    answer:
      "A one-time contribution of $12.50 towards the costs of running the forum. It adds a small badge next to your name and nothing else: no rank, no credits, no extra features.",
  },
  {
    question: "Can I actually donate here?",
    answer:
      "No. This forum is a demo, so the donation button does not charge anything and no payment details are collected.",
  },
];

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
  rank: Rank;
  award: RankAward;
}) {
  return (
    <div className="relative hidden h-80 w-[26rem] shrink-0 select-none lg:block">
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--primary)_22%,transparent),transparent)]" />
      {award && (
        <div
          className={cn(floatingCardClass, "top-0 right-0 w-64 rotate-3 p-4")}
        >
          <div className="flex items-center gap-3">
            <AwardIcon award={award} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{award.name}</p>
              <p className="text-xs text-tier-legendary">Exclusive award</p>
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
        <UserAvatar user={user} size="xl" link={false} />
        <p className="mt-3 flex items-center gap-1.5">
          <UserLink
            user={user}
            className={cn(
              "truncate text-base font-bold",
              nameColor(rank.headline.nameColor)?.text,
            )}
          />
          <RankBadge rank={rank} />
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.title}</p>
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
        <span className="text-sm font-bold">Paid with credits</span>
      </div>
      <div
        className={cn(
          floatingCardClass,
          "right-24 bottom-0 flex rotate-2 items-center gap-2 px-3 py-2 text-xs font-medium",
        )}
      >
        <Check className="size-3.5 text-success" />
        Lifetime perks
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
  rank: Rank;
  viewer: UserView | null;
  highlighted: boolean;
}) {
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
          Log in to upgrade
        </Link>
        <p className="mt-2 h-4 truncate text-xs text-muted-foreground">
          Paid with the credits you earn.
        </p>
      </div>
    );
  }
  const current = viewer.rank;
  if (current?.id === rank.id) {
    return (
      <Settled note="This is the rank shown next to your name.">
        <Check aria-hidden="true" className="size-4 text-success" />
        Your current rank
      </Settled>
    );
  }
  if (current && current.price > rank.price) {
    return (
      <Settled note={`Everything here comes with ${current.name}.`}>
        <Check aria-hidden="true" className="size-4 text-muted-foreground" />
        Included
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
  recommended,
}: {
  rank: Rank;
  award: RankAward;
  viewer: UserView | null;
  recommended: boolean;
}) {
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
          Recommended
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
              ? `${formatNumber(rank.price - current.price)} from ${current.name}`
              : "credits, once"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <RankAction rank={rank} viewer={viewer} highlighted={recommended} />
      </div>

      <ul className="mt-3">
        <Grant label="Name colour">
          <span
            className={cn(
              "min-w-0 truncate font-semibold",
              nameColor(rank.headline.nameColor)?.text,
            )}
          >
            {viewer ? (
              <UserLink
                user={viewer}
                className={nameColor(rank.headline.nameColor)?.text}
              />
            ) : (
              "your_name"
            )}
          </span>
        </Grant>
        {award && (
          <Grant label="Award">
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">
                +{formatNumber(award.xp)} XP
              </span>
              <AwardIcon award={award} size="sm" className="size-6" />
            </span>
          </Grant>
        )}
        <Grant label="Rank badge">
          <RankBadge rank={rank} />
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
            <span className="sr-only">
              {included ? "Included: " : "Not included: "}
            </span>
            {label}
          </li>
        ))}
      </ul>
    </li>
  );
}

function Donor({ viewer }: { viewer: UserView | null }) {
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
          Donor
          <DonorBadge />
          <span className="text-sm font-medium text-muted-foreground">
            $12.50, one time
          </span>
        </h2>
        <p className="mt-1 max-w-prose text-sm text-pretty text-muted-foreground">
          A donation helps pay for hosting and keeps the forum free of ads. It
          is not an upgrade: the only thing you get is the donor badge next to
          your name. No rank, no credits, no extra features.
        </p>
      </div>
      <div className="md:w-56">
        {viewer?.donor ? (
          <p className="flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium">
            <Check aria-hidden="true" className="size-4 text-success" />
            You are a donor. Thank you.
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled
            className="h-10 w-full"
          >
            Donate $12.50
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground md:text-center">
          Payments are not available in this demo.
        </p>
      </div>
    </section>
  );
}

export default async function UpgradePage() {
  const [viewer, ranks, awards] = await Promise.all([
    getCurrentUser(),
    getRanks(),
    getAwards(),
  ]);
  const sample = viewer ?? (await getLeaderboard("xp", 1))[0];
  const awardOf = (rank: Rank) =>
    awards.find((award) => award.slug === rank.headline.award);
  const top = ranks[ranks.length - 1];
  const recommended = ranks[Math.floor(ranks.length / 2)];

  return (
    <>
      <Container className="flex items-center justify-between gap-10 py-12 md:py-20">
        <div className="max-w-xl">
          <h1 className={heroTitleClass}>
            Ready to <span className="text-primary">level up</span>
            <br />
            your experience?
          </h1>
          <p className={cn("mt-4 max-w-md", heroSubtitleClass)}>
            Spend your credits on a rank to unlock its name colour, an award
            nobody else can earn and a set of lasting perks.
          </p>
          <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm text-pretty">
            <Coins
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <span>
              <span className="font-semibold">
                Credits are earned by taking part, not bought.
              </span>{" "}
              <span className="text-muted-foreground">
                {viewer ? (
                  <>
                    You have{" "}
                    <span className="font-semibold text-foreground tabular-nums">
                      {formatNumber(viewer.credits)}
                    </span>{" "}
                    to spend.
                  </>
                ) : (
                  "No rank can be paid for with money."
                )}
              </span>
            </span>
          </p>
        </div>
        <HeroArt user={sample} rank={top} award={awardOf(top)} />
      </Container>

      <Container className="space-y-12 pb-8">
        <section aria-labelledby="ranks-title" className="space-y-8">
          <h2 id="ranks-title" className="sr-only">
            Ranks
          </h2>
          <ul className="grid gap-6 md:grid-cols-3 md:gap-4">
            {ranks.map((rank) => (
              <RankCard
                key={rank.id}
                rank={rank}
                award={awardOf(rank)}
                viewer={viewer}
                recommended={rank.id === recommended.id}
              />
            ))}
          </ul>
          <Donor viewer={viewer} />
        </section>

        <section aria-labelledby="faq-title">
          <h2
            id="faq-title"
            className="text-center text-2xl font-semibold tracking-tight"
          >
            Questions and answers
          </h2>
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-lg border bg-card">
            {FAQ.map(({ question, answer }) => (
              <details key={question} className="group">
                <summary className="flex min-h-12 cursor-pointer list-none -outline-offset-2 items-center justify-between gap-3 px-4 py-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                  {question}
                  <ChevronDown
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  />
                </summary>
                <p className="px-4 pb-4 text-sm text-pretty text-muted-foreground">
                  {answer}
                </p>
              </details>
            ))}
          </div>
        </section>
      </Container>
    </>
  );
}
