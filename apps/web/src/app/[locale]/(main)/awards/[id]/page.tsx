import { awardsGet, awardsHolders, awardsMember } from "@sermo/core/contracts";
import { Check, Lock, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { TIERS } from "@/app/[locale]/(main)/awards/tiers";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { LoadMore } from "@/components/forum/load-more";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { formatDate, formatNumber } from "@/lib/format";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { cn } from "@/lib/utils";

// A path that is not a plain number is a page that does not exist.
function awardIdOf(raw: string) {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) notFound();
  return id;
}

// Asked once per request for the metadata and the page. An unknown or inactive award is the 404.
const getAward = cache((awardId: number) => read(awardsGet, { awardId }));

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/awards/[id]">): Promise<Metadata> {
  const { id } = await params;
  const [t, award] = await Promise.all([
    getTranslations("awards.award"),
    getAward(awardIdOf(id)),
  ]);
  return { title: t("metaTitle", { name: award.name }) };
}

// A member holding a stackable award twice is two grants and two rows: the list is as the backend
// returns it.
async function Holders({
  awardId,
  viewerId,
  cursor,
}: {
  awardId: number;
  viewerId?: number;
  cursor?: string;
}) {
  const locale = await getLocale();
  const [t, holders] = await Promise.all([
    getTranslations("awards.award"),
    read(awardsHolders, { awardId, cursor }),
  ]);
  const member = await membersFor(holders.items.map(({ user }) => user));
  const award = await getAward(awardId);
  return (
    <SectionCard
      title={t("holdersHeading")}
      description={t("grants", { count: award.grantCount })}
    >
      {holders.items.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <ol className="divide-y divide-border">
          {holders.items.map((grant) => {
            const holder = member(grant.user.id);
            return (
              <li
                key={grant.id}
                className={cn(
                  "flex min-h-14 items-center gap-3 px-4 py-2",
                  grant.user.id === viewerId && "bg-primary/5",
                )}
              >
                <UserAvatar user={holder} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <UserLink user={holder} className="truncate text-sm" />
                    <UserBadges user={holder} limit={1} />
                    <LevelBadge level={holder} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {grant.reason || holder.title}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {formatDate(grant.grantedAt, locale)}
                  </p>
                  <RelativeTime date={grant.grantedAt} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {holders.nextCursor && (
        <div className="p-3">
          <LoadMore
            href={`/awards/${awardId}?cursor=${encodeURIComponent(holders.nextCursor)}`}
          >
            {t("loadMore")}
          </LoadMore>
        </div>
      )}
    </SectionCard>
  );
}

async function Standing({ awardId }: { awardId: number }) {
  const locale = await getLocale();
  const { user } = await getViewer();
  if (!user) return null;
  const [t, held] = await Promise.all([
    getTranslations("awards.award"),
    read(awardsMember, { userId: user.id }),
  ]);
  const earnedAt = held.items.find(
    ({ award }) => award.id === awardId,
  )?.lastGrantedAt;
  return (
    <p
      className={cn(
        "mt-6 inline-flex items-center gap-1.5 text-sm",
        earnedAt ? "font-medium text-success" : "text-muted-foreground",
      )}
    >
      {earnedAt ? (
        <>
          <Check aria-hidden="true" className="size-4" />
          {t("earnedDate", { date: formatDate(earnedAt, locale) })}
        </>
      ) : (
        <>
          <Lock aria-hidden="true" className="size-3.5" />
          {t("unearnedDescription")}
        </>
      )}
    </p>
  );
}

export default async function AwardPage({
  params,
  searchParams,
}: PageProps<"/[locale]/awards/[id]">) {
  const locale = await getLocale();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const awardId = awardIdOf(id);
  const cursor = first(query.cursor) || undefined;
  const [t, tTiers, award, { user }] = await Promise.all([
    getTranslations("awards.award"),
    getTranslations("awards.tiers"),
    getAward(awardId),
    getViewer(),
  ]);
  const tier = TIERS[award.tier];

  return (
    <PageLayout className="pt-2" mainClassName="space-y-4">
      <PageBreadcrumb
        items={[
          { label: t("homeLabel"), href: "/" },
          { label: t("awardsLabel"), href: "/awards" },
          { label: award.name },
        ]}
      />

      <section className="relative isolate flex flex-col items-center overflow-hidden rounded-lg border bg-card px-4 py-8 text-center md:items-start md:px-10 md:py-14 md:text-left">
        {award.image && (
          <Art
            category="awards"
            src={award.image.url}
            className="absolute inset-0 -z-10 opacity-30 [mask-image:linear-gradient(to_left,black_30%,transparent)]"
          />
        )}
        <AwardIcon
          award={award}
          size="lg"
          className="size-16 md:size-20 [&_svg]:size-8 md:[&_svg]:size-10"
        />
        <p
          className={cn(
            "mt-5 text-xs font-semibold tracking-wide uppercase",
            tier.text,
          )}
        >
          {t("tierLabel", { tier: tTiers(award.tier) })}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance [overflow-wrap:anywhere] md:text-4xl">
          {award.name}
        </h1>
        <p className="mt-2 max-w-md text-pretty text-muted-foreground [overflow-wrap:anywhere]">
          {award.description}
        </p>
        <div className="mt-6 flex items-start justify-center gap-8 md:justify-start">
          <StatInline
            label={t("xpLabel")}
            value={t("xpValue", { xp: formatNumber(award.xp, locale) })}
          />
          <StatInline
            label={t("grantsLabel", { count: award.grantCount })}
            value={formatNumber(award.grantCount, locale)}
          />
        </div>
        {user && (
          <Suspense fallback={<div className="mt-6 h-5" />}>
            <Standing awardId={awardId} />
          </Suspense>
        )}
      </section>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingHolders")}>
            <MemberListSkeleton />
          </LoadingRegion>
        }
      >
        <Holders awardId={awardId} viewerId={user?.id} cursor={cursor} />
      </Suspense>
    </PageLayout>
  );
}
