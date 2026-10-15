import { awardsGet, awardsMember } from "@sermo/core/contracts";
import { Check, Lock, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { cache, Suspense } from "react";
import { holdersPage } from "@/app/[locale]/(main)/awards/[id]/holders-page";
import { moreHolders } from "@/app/[locale]/(main)/awards/[id]/more-holders";
import { TIERS } from "@/app/[locale]/(main)/awards/tiers";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { PagedCard } from "@/components/forum/paged-card";
import {
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { StatInline } from "@/components/forum/stat";
import { PageLayout } from "@/components/layout/page-layout";
import { formatDate, formatNumber } from "@/lib/format";
import { pagesParam } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
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

// The award's holders, newest grant first.
async function Holders({
  awardId,
  cursor,
  pages,
}: {
  awardId: number;
  cursor?: string;
  pages: number;
}) {
  const [t, first] = await Promise.all([
    getTranslations("awards.award"),
    holdersPage(awardId, cursor),
  ]);
  const award = await getAward(awardId);
  return (
    <PagedCard
      title={t("holdersHeading")}
      description={t("grants", { count: award.grantCount })}
      empty={{
        icon: Users,
        title: t("emptyTitle"),
        description: t("emptyDescription"),
      }}
      first={first}
      more={moreHolders.bind(null, awardId)}
      pages={pages}
      start={cursor}
      listKey={["award", awardId]}
      hrefBase={`/awards/${awardId}`}
      moreLabel={t("loadMore")}
      estimateSize={64}
      as="ul"
    />
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
        <Holders
          awardId={awardId}
          cursor={cursor}
          pages={pagesParam(query.pages)}
        />
      </Suspense>
    </PageLayout>
  );
}
