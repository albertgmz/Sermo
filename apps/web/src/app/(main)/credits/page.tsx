import { creditsHistory, usersList } from "@sermo/core/contracts";
import { Check, Coins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { History } from "@/app/(main)/credits/history";
import { Inventory } from "@/app/(main)/credits/inventory";
import { Shop } from "@/app/(main)/credits/shop";
import { Leaderboard } from "@/components/forum/leaderboard";
import { SectionCard } from "@/components/forum/section-card";
import {
  BalanceSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  ShopSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { leaderboardMember } from "@/lib/member-items";
import { read, readIfAllowed } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("credits.credits");
  return { title: t("metaTitle") };
}

const TABS = ["shop", "inventory", "history"] as const;
const NOTICES = ["bought", "worn", "removed", "used"] as const;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

async function Balance() {
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
              className="size-9 shrink-0 text-primary"
            />
            {formatNumber(ledger.balance)}
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
    readIfAllowed(usersList, { sort: "credits", limit: 10 }),
  ]);
  // The member directory needs a permission a guest may lack: then there is no ranking to show.
  if (!richest) return null;
  return (
    <SectionCard
      title={t("leadersHeading")}
      description={t("leadersDescription")}
    >
      <Leaderboard
        members={richest.items.map(leaderboardMember)}
        by="credits"
        viewerId={user?.id}
      />
    </SectionCard>
  );
}

async function Content({
  searchParams,
}: Pick<PageProps<"/credits">, "searchParams">) {
  const [t, query, { user }] = await Promise.all([
    getTranslations("credits.credits"),
    searchParams,
    getViewer(),
  ]);
  const notice = NOTICES.find((entry) => entry === first(query.notice));
  const requested = TABS.find((entry) => entry === first(query.tab));
  const tab = user && requested ? requested : "shop";
  const labels = {
    shop: t("shopTab"),
    inventory: t("inventoryTab"),
    history: t("historyTab"),
  };
  return (
    <>
      {user ? (
        <TabLinks
          tabs={TABS.map((value) => ({
            value,
            label: labels[value],
            href: value === "shop" ? "/credits" : `/credits?tab=${value}`,
          }))}
          active={tab}
          label={t("aria.sections")}
        />
      ) : (
        <h2 className="border-b pb-2 text-lg font-semibold tracking-tight">
          {t("shopTab")}
        </h2>
      )}
      {notice && (
        <output className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-pretty">
          <Check
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          {t(`notices.${notice}`)}
        </output>
      )}
      {tab === "shop" && (
        <Shop
          category={first(query.category)}
          cursor={first(query.cursor) || undefined}
          viewer={user && { id: user.id, username: user.username }}
        />
      )}
      {tab === "inventory" && user && (
        <Inventory
          viewer={{ id: user.id, username: user.username }}
          cursors={{
            active: first(query.active) || undefined,
            unused: first(query.unused) || undefined,
            threads: first(query.threads) || undefined,
          }}
        />
      )}
      {tab === "history" && user && (
        <History cursor={first(query.cursor) || undefined} />
      )}
    </>
  );
}

export default async function CreditsPage({
  searchParams,
}: PageProps<"/credits">) {
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
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingLeaders")}>
                <MemberListSkeleton rows={10} />
              </LoadingRegion>
            }
          >
            <Leaders />
          </Suspense>
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
          <Content searchParams={searchParams} />
        </Suspense>
      </PageLayout>
    </>
  );
}
