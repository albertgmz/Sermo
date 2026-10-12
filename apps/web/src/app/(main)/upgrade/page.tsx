import { creditsHistory, pagesGet } from "@sermo/core/contracts";
import { Check, Coins, Crown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { currentRank, getLadder, type Rank } from "@/app/(main)/upgrade/ladder";
import { RankForm } from "@/app/(main)/upgrade/rank-form";
import {
  FaqSkeleton,
  HeroSkeleton,
  RanksSkeleton,
} from "@/app/(main)/upgrade/skeletons";
import { Credits } from "@/components/forum/credits";
import { EmptyState } from "@/components/forum/empty-state";
import { HtmlContent } from "@/components/forum/html-content";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import {
  heroSubtitleClass,
  heroTitleClass,
} from "@/components/layout/page-hero";
import { buttonVariants } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { call, read } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("upgrade.upgrade");
  return { title: t("metaTitle") };
}

const FAQ_SLUG = "upgrade-faq";

function Settled({
  children,
  note,
}: {
  children: React.ReactNode;
  note: string;
}) {
  return (
    <div>
      <p className="flex h-10 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium">
        {children}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

async function RankAction({
  rank,
  signedIn,
  current,
}: {
  rank: Rank;
  signedIn: boolean;
  current: Rank | null;
}) {
  const t = await getTranslations("upgrade.upgrade");
  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent("/upgrade")}`}
        className={cn(buttonVariants({ variant: "outline" }), "h-10 w-full")}
      >
        {t("login")}
      </Link>
    );
  }
  if (current?.id === rank.id) {
    return (
      <Settled note={t("currentRankNote")}>
        <Check aria-hidden="true" className="size-4 text-success" />
        {t("currentRank")}
      </Settled>
    );
  }
  // The backend only moves a member up: a rank that costs the same or less is not offered.
  if (current && rank.price <= current.price) {
    const same = rank.price === current.price;
    return (
      <Settled
        note={t(same ? "samePriceNote" : "belowNote", { rank: current.name })}
      >
        <Check aria-hidden="true" className="size-4 text-muted-foreground" />
        {t(same ? "samePrice" : "below")}
      </Settled>
    );
  }
  return (
    <RankForm
      itemId={rank.id}
      rankName={rank.name}
      cost={formatNumber(rank.price - (current?.price ?? 0))}
      upgrade={Boolean(current)}
    />
  );
}

async function RankCard({
  rank,
  signedIn,
  current,
}: {
  rank: Rank;
  signedIn: boolean;
  current: Rank | null;
}) {
  const t = await getTranslations("upgrade.upgrade");
  const upgrading = current && current.price < rank.price;
  return (
    <li className="relative flex flex-col rounded-xl border bg-card p-4 md:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-xl font-bold tracking-tight [overflow-wrap:anywhere]">
          <Crown
            aria-hidden="true"
            className="size-5 shrink-0 text-tier-gold"
          />
          {rank.name}
        </h3>
        <div className="shrink-0 text-right">
          <p className="text-2xl leading-none tracking-tight">
            <Credits value={rank.price} />
          </p>
          {upgrading && (
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {t("upgradePrice", {
                price: formatNumber(rank.price - current.price),
                rank: current.name,
              })}
            </p>
          )}
        </div>
      </div>
      <div className="mt-4">
        <RankAction rank={rank} signedIn={signedIn} current={current} />
      </div>
      {rank.description && (
        <>
          <hr className="my-4" />
          <p className="text-sm whitespace-pre-line text-pretty [overflow-wrap:anywhere]">
            {rank.description}
          </p>
        </>
      )}
    </li>
  );
}

async function Hero() {
  const [t, { user }] = await Promise.all([
    getTranslations("upgrade.upgrade"),
    getViewer(),
  ]);
  const ledger = user ? await read(creditsHistory, { limit: 1 }) : null;
  return (
    <Container className="py-12 md:py-20">
      <div className="max-w-xl">
        <h1 className={heroTitleClass}>{t("heading")}</h1>
        <p className={cn("mt-4 max-w-md", heroSubtitleClass)}>
          {t("description")}
        </p>
        <p className="mt-5 flex max-w-md items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm text-pretty">
          <Coins
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          <span className="text-muted-foreground">
            {ledger
              ? t.rich("credits", {
                  count: ledger.balance,
                  amount: (chunks) => (
                    <span className="font-semibold text-foreground tabular-nums">
                      {chunks}
                    </span>
                  ),
                })
              : t("guestCredits")}
          </span>
        </p>
      </div>
    </Container>
  );
}

async function Notice({
  searchParams,
}: Pick<PageProps<"/upgrade">, "searchParams">) {
  const [{ notice }, t] = await Promise.all([
    searchParams,
    getTranslations("upgrade.upgrade"),
  ]);
  if (notice !== "upgraded") return null;
  return (
    <output className="mb-6 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty">
      <Check
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-success"
      />
      {t("upgraded")}
    </output>
  );
}

async function Ranks() {
  const [t, { user }, ladder] = await Promise.all([
    getTranslations("upgrade.upgrade"),
    getViewer(),
    getLadder(),
  ]);
  if (!ladder) {
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          icon={Crown}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      </div>
    );
  }
  const current = user ? await currentRank(ladder.category.id) : null;
  return (
    <section aria-labelledby="ranks-title">
      <h2 id="ranks-title" className="sr-only">
        {t("aria.ranks")}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ladder.ranks.map((rank) => (
          <RankCard
            key={rank.id}
            rank={rank}
            signedIn={Boolean(user)}
            current={current}
          />
        ))}
      </ul>
    </section>
  );
}

// The page of questions is written by the administrators; without it there is no section.
async function Faq() {
  let page: Awaited<ReturnType<typeof getFaq>>;
  try {
    page = await getFaq();
  } catch (error) {
    // The section is a courtesy: whatever the backend says about it, the ranks above stay.
    if (!(error instanceof SermoError)) throw error;
    if (error.code !== "not_found")
      console.error("The FAQ could not be read", error);
    return null;
  }
  return (
    <section aria-labelledby="faq-title">
      <h2
        id="faq-title"
        className="text-2xl font-semibold tracking-tight text-balance"
      >
        {page.title}
      </h2>
      <HtmlContent className="mt-4 max-w-prose">{page.bodyHtml}</HtmlContent>
    </section>
  );
}

function getFaq() {
  return call(pagesGet, { slug: FAQ_SLUG });
}

export default async function UpgradePage({
  searchParams,
}: PageProps<"/upgrade">) {
  const t = await getTranslations("upgrade.upgrade");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingDetails")}>
            <HeroSkeleton />
          </LoadingRegion>
        }
      >
        <Hero />
      </Suspense>
      <Container className="space-y-12 pb-8">
        <Suspense fallback={null}>
          <Notice searchParams={searchParams} />
        </Suspense>
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingRanks")}>
              <RanksSkeleton />
            </LoadingRegion>
          }
        >
          <Ranks />
        </Suspense>
        <Suspense fallback={<FaqSkeleton />}>
          <Faq />
        </Suspense>
      </Container>
    </>
  );
}
