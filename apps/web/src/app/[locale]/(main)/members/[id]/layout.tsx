import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { memberAdminTabs } from "@/app/[locale]/(main)/members/[id]/manage-tabs";
import {
  getProfile,
  memberIdOf,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { ProfileHeader } from "@/app/[locale]/(main)/members/[id]/profile-header";
import { LevelStrip } from "@/app/[locale]/(main)/members/[id]/sections";
import { adultMarked } from "@/components/forum/adult-badge";
import { SegmentTabLinks } from "@/components/forum/segment-tab-links";
import {
  LoadingRegion,
  ProfileHeaderSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";
import { profileTabPath } from "@/lib/profile-tabs";
import { activitiesFor } from "@/lib/sermo/activity";
import { canonicalPathOf } from "@/lib/sermo/addresses";
import { relationsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { getSite } from "@/lib/sermo/site";

// A member's page: the header (cover, avatar, name, stats, device, actions), the level strip and
// the tab bar, shared by the wall (this folder's page) and the tabs under it (`posts`, `threads`,
// `about`). A tab pressed is a navigation to the tab's page: this layout stays on screen as it is
// (it is not asked for again, nor drawn again), and only the tab's panel comes in, behind the tab's
// own `loading.tsx`. What the header shows is read here, once per page load; the pages read the
// profile through the same `cache()`d reader, so a page load asks the backend for it once.

function LevelStripSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="mb-4 flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3"
    >
      <Skeleton className="h-5 w-12" />
      <Skeleton className="h-2 w-24 sm:w-64 lg:w-96" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

async function ProfileTop({
  params,
}: {
  params: LayoutProps<"/[locale]/members/[id]">["params"];
}) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  const userId = memberIdOf(id);
  // The last seen line names the page the member viewed within the hour, read beside the profile.
  const [profile, activities, site, relations, t] = await Promise.all([
    getProfile(userId),
    activitiesFor([userId]),
    getSite(),
    relationsFor(viewer.user?.id ?? null, [userId]),
    getTranslations("members.profile"),
  ]);
  // The profile's own path, as the browser shows it: every tab is under it, so that a tab pressed
  // keeps this layout (another spelling of the profile would be another page).
  const address = canonicalPathOf(profile.seo.canonical);
  return (
    <>
      <ProfileHeader
        profile={profile}
        address={address}
        viewerId={viewer.user?.id ?? null}
        relation={relations(userId)}
        activity={activities.get(profile.id) ?? null}
        adult={adultMarked(site.adultMode, profile.isAdult)}
        manage={memberAdminTabs(viewer, profile.id)}
      />
      <Container className="pt-5">
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingSections")}>
              <LevelStripSkeleton />
            </LoadingRegion>
          }
        >
          <LevelStrip profile={profile} address={address} />
        </Suspense>
        <SegmentTabLinks
          label={t("aria.sections")}
          tabs={[
            { value: "", label: t("wallTab"), href: address },
            {
              value: "posts",
              label: t("postsTab"),
              href: profileTabPath(address, "posts"),
              count: profile.postCount,
            },
            {
              value: "threads",
              label: t("threadsTab"),
              href: profileTabPath(address, "threads"),
            },
            {
              value: "about",
              label: t("aboutTab"),
              href: profileTabPath(address, "about"),
            },
          ]}
        />
      </Container>
    </>
  );
}

export default function ProfileLayout({
  children,
  params,
}: LayoutProps<"/[locale]/members/[id]">) {
  const t = useTranslations("members.profile");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingHeader")}>
            <ProfileHeaderSkeleton />
            <Container className="pt-5">
              <LevelStripSkeleton />
              <TabsSkeleton />
            </Container>
          </LoadingRegion>
        }
      >
        <ProfileTop params={params} />
      </Suspense>
      {children}
    </>
  );
}
