import { creditsHistory, usersList } from "@sermo/core/contracts";
import { Coins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Content } from "@/app/[locale]/(main)/credits/content";
import { creditsContent } from "@/app/[locale]/(main)/credits/credits-content";
import { Ways } from "@/app/[locale]/(main)/credits/ways";
import { Leaderboard } from "@/components/forum/leaderboard";
import { placeOfQuery } from "@/components/forum/places";
import { SectionCard } from "@/components/forum/section-card";
import {
  BalanceSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  ShopSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabSwitch } from "@/components/forum/tab-switch";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits } from "@/lib/format";
import { read, readIfAllowed } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("credits.credits");
  return { title: t("metaTitle") };
}

async function Balance() {
  const locale = await getLocale();
  const [t, { user }] = await Promise.all([
    getTranslations("credits.credits"),
    getViewer(),
  ]);
  const ledger = user ? await read(creditsHistory, { limit: 1 }) : null;
  return (
    <section
      aria-labelledby="balance-title"
      className="rounded-lg border bg-card p-4 md:p-6"
    >
      <h2 id="balance-title" className="text-sm font-semibold">
        {t("balanceHeading")}
      </h2>
      {ledger ? (
        <>
          <p className="mt-3 flex items-center gap-3 text-5xl leading-none font-bold tracking-tighter tabular-nums">
            <Coins
              aria-hidden="true"
              className="size-9 shrink-0 text-primary-ink"
            />
            {formatCredits(ledger.balance, locale)}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("balanceDescription")}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-sm text-sm text-pretty text-muted-foreground">
            {t("loginDescription")}
          </p>
          <Link
            href={`/login?next=${encodeURIComponent("/credits")}`}
            className={cn(buttonVariants(), "mt-4 h-10 px-4 md:h-8 md:px-3")}
          >
            {t("login")}
          </Link>
        </>
      )}
    </section>
  );
}

async function Leaders() {
  const [t, { user }, richest] = await Promise.all([
    getTranslations("credits.credits"),
    getViewer(),
    readIfAllowed(usersList, { sort: "credits", ranked: true, limit: 10 }),
  ]);
  // The member directory needs a permission a guest may lack: then there is no ranking to show,
  // and none while nobody holds a credit.
  if (!richest || richest.items.length === 0) return null;
  return (
    <SectionCard
      title={t("leadersHeading")}
      description={t("leadersDescription")}
    >
      <Leaderboard members={richest.items} by="credits" viewerId={user?.id} />
    </SectionCard>
  );
}

// The parameters of the address the tabs, the shop's categories and the inventory's lists change in
// place.
const CREDITS_SWITCH_PARAMS = [
  "tab",
  "category",
  "active",
  "unused",
  "threads",
];

// The tabs and the open one, which they change in place (`TabSwitch`).
async function SwitchedContent({
  searchParams,
}: Pick<PageProps<"/[locale]/credits">, "searchParams">) {
  const query = await searchParams;
  return (
    <TabSwitch
      place={placeOfQuery(query, CREDITS_SWITCH_PARAMS)}
      params={CREDITS_SWITCH_PARAMS}
      stamp={Date.now()}
      load={creditsContent}
      className="space-y-4"
    >
      <Content query={query} />
    </TabSwitch>
  );
}

export default async function CreditsPage({
  searchParams,
}: PageProps<"/[locale]/credits">) {
  const t = await getTranslations("credits.credits");
  return (
    <>
      <PageHero title={t("title")} subtitle={t("subtitle")} />
      <Container>
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingBalance")}>
              <BalanceSkeleton />
            </LoadingRegion>
          }
        >
          <Balance />
        </Suspense>
      </Container>
      <PageLayout
        className="pt-6"
        mainClassName="space-y-4"
        aside={
          <>
            <Suspense
              fallback={
                <LoadingRegion label={t("aria.loadingWays")}>
                  <MemberListSkeleton rows={3} />
                </LoadingRegion>
              }
            >
              <Ways />
            </Suspense>
            <Suspense
              fallback={
                <LoadingRegion label={t("aria.loadingLeaders")}>
                  <MemberListSkeleton rows={10} />
                </LoadingRegion>
              }
            >
              <Leaders />
            </Suspense>
          </>
        }
      >
        <Suspense
          fallback={
            <LoadingRegion label={t("aria.loadingShop")}>
              <TabsSkeleton />
              <ShopSkeleton />
            </LoadingRegion>
          }
        >
          <SwitchedContent searchParams={searchParams} />
        </Suspense>
      </PageLayout>
    </>
  );
}
