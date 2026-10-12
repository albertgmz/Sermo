import { Heart, MessageCircle, Star, Users } from "lucide-react";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { getSelf } from "@/app/(main)/account/data";
import type { SearchParams } from "@/app/(main)/account/notice";
import {
  AboutSection,
  ReferralSection,
  TitleSection,
  UsernameSection,
} from "@/app/(main)/account/profile-forms";
import { PicturesSection } from "@/app/(main)/account/profile-pictures";
import { ProfileSkeleton } from "@/app/(main)/account/profile-skeleton";
import { LoadingRegion } from "@/components/forum/skeletons";
import { StatTile } from "@/components/forum/stat";
import { formatNumber } from "@/lib/format";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.profile");
  return { title: t("metaTitle") };
}

async function Stats() {
  const [t, { profile }] = await Promise.all([
    getTranslations("account.profile"),
    getSelf(),
  ]);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t("postsLabel")}
        icon={MessageCircle}
        value={formatNumber(profile.postCount)}
      />
      <StatTile
        label={t("reputationLabel")}
        icon={Star}
        value={formatNumber(profile.reactionScore)}
      />
      <StatTile
        label={t("followersLabel")}
        icon={Users}
        value={formatNumber(profile.followerCount)}
      />
      <StatTile
        label={t("followingLabel")}
        icon={Heart}
        value={formatNumber(profile.followingCount)}
      />
    </div>
  );
}

export default function AccountPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const t = useTranslations("account.profile");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">{t("heading")}</h1>
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ProfileSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Stats />
          <PicturesSection searchParams={searchParams} />
          <UsernameSection searchParams={searchParams} />
          <AboutSection searchParams={searchParams} />
          <TitleSection searchParams={searchParams} />
          <ReferralSection />
        </div>
      </Suspense>
    </div>
  );
}
