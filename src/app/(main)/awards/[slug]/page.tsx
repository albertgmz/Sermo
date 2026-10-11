import { Check, Lock, Users } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TIERS } from "@/app/(main)/awards/tiers";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { EmptyState } from "@/components/forum/empty-state";
import { LevelBadge } from "@/components/forum/level";
import { PageBreadcrumb } from "@/components/forum/page-breadcrumb";
import { RelativeTime } from "@/components/forum/relative-time";
import { RoleBadge } from "@/components/forum/role-badge";
import { SectionCard } from "@/components/forum/section-card";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { PageLayout } from "@/components/layout/page-layout";
import { getAward } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const award = await getAward(slug);
  return { title: `${award?.name ?? "Award"} - forum/ui` };
}

export default async function AwardPage({ params }: Props) {
  const [{ slug }, viewer] = await Promise.all([params, getCurrentUser()]);
  const award = await getAward(slug);
  if (!award) notFound();

  const tier = TIERS[award.tier];
  const earnedAt = viewer?.awards.find((a) => a.id === award.id)?.awardedAt;

  return (
    <PageLayout className="pt-2" mainClassName="space-y-4">
      <PageBreadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Awards", href: "/awards" },
          { label: award.name },
        ]}
      />

      <section className="relative isolate flex flex-col items-center overflow-hidden rounded-lg border bg-card px-4 pb-8 text-center md:items-start md:px-10 md:py-14 md:text-left">
        <Art
          src={award.image}
          className="-mx-4 -mb-10 aspect-video self-stretch [mask-image:linear-gradient(to_bottom,black_55%,transparent)] md:absolute md:inset-y-0 md:right-0 md:-z-10 md:m-0 md:[mask-image:linear-gradient(to_left,black_55%,transparent)]"
        />
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
          {tier.label} award
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-balance md:text-4xl">
          {award.name}
        </h1>
        <p className="mt-2 max-w-md text-pretty text-muted-foreground">
          {award.description}
        </p>
        <div className="mt-6 flex items-start justify-center gap-8 md:justify-start">
          <StatInline label="XP" value={`+${formatNumber(award.xp)}`} />
          <StatInline
            label={award.holders.length === 1 ? "Holder" : "Holders"}
            value={formatNumber(award.holders.length)}
          />
        </div>
        {viewer && (
          <p
            className={cn(
              "mt-6 inline-flex items-center gap-1.5 text-sm",
              earnedAt ? "font-medium text-success" : "text-muted-foreground",
            )}
          >
            {earnedAt ? (
              <>
                <Check aria-hidden="true" className="size-4" />
                You earned this on {formatDate(earnedAt)}
              </>
            ) : (
              <>
                <Lock aria-hidden="true" className="size-3.5" />
                You have not earned this award yet
              </>
            )}
          </p>
        )}
      </section>

      <SectionCard
        title="Holders"
        description={`${formatNumber(award.holders.length)} ${award.holders.length === 1 ? "member has" : "members have"} this award`}
      >
        {award.holders.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No holders yet"
            description="Nobody has earned this award so far."
          />
        ) : (
          <ol className="divide-y divide-border">
            {award.holders.map(({ user, awardedAt }) => (
              <li
                key={user.id}
                className={cn(
                  "flex min-h-14 items-center gap-3 px-4 py-2",
                  user.id === viewer?.id && "bg-primary/5",
                )}
              >
                <UserAvatar user={user} size="lg" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <UserLink user={user} className="truncate text-sm" />
                    <RoleBadge user={user} />
                    <LevelBadge level={user.level} />
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {user.title}
                  </p>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {formatDate(awardedAt)}
                  </p>
                  <RelativeTime date={awardedAt} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </PageLayout>
  );
}
