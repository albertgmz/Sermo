import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { memberAdminTabs } from "@/app/[locale]/(main)/members/[id]/manage-tabs";
import {
  getProfile,
  memberIdOf,
  type Profile,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { ProfileHeader } from "@/app/[locale]/(main)/members/[id]/profile-header";
import {
  PROFILE_TAB_PARAMS,
  ProfileSections,
} from "@/app/[locale]/(main)/members/[id]/sections";
import { profileSections } from "@/app/[locale]/(main)/members/[id]/sections-page";
import { adultMarked } from "@/components/forum/adult-badge";
import { JsonLd } from "@/components/forum/json-ld";
import { pageParam } from "@/components/forum/page-window";
import { placeOfQuery } from "@/components/forum/places";
import {
  LoadingRegion,
  ProfileHeaderSkeleton,
} from "@/components/forum/skeletons";
import { TabSwitch } from "@/components/forum/tab-switch";
import { activitiesFor } from "@/lib/sermo/activity";
import { relationsFor } from "@/lib/sermo/members";
import { copyOf, seoMetadata } from "@/lib/sermo/seo";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { getSite } from "@/lib/sermo/site";

// The backend has one address for a profile; another tab or a continued list is a copy of it.
function seoOf(profile: Profile, query: Record<string, unknown>) {
  const copy =
    query.tab !== undefined ||
    query.cursor !== undefined ||
    query.pages !== undefined ||
    query.page !== undefined ||
    query.comments !== undefined ||
    query.commentsCursor !== undefined ||
    query.post !== undefined ||
    query.comment !== undefined;
  return copy ? copyOf(profile.seo) : profile.seo;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/members/[id]">): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await getProfile(memberIdOf(id));
  const head = seoMetadata(seoOf(profile, query));
  // Shared as a profile only when guests may see it (the backend indexes it).
  if (profile.seo.robots !== "index,follow") return head;
  return publicHead(head, {
    title: profile.username,
    card: { kind: "members", id: profile.id, seo: profile.seo },
    kind: { type: "profile", username: profile.username },
  });
}

export default async function ProfilePage({
  params,
  searchParams,
}: PageProps<"/[locale]/members/[id]">) {
  const [{ id: raw }, query, viewer] = await Promise.all([
    params,
    searchParams,
    getViewer(),
  ]);
  const userId = memberIdOf(raw);
  // The last seen line names the page the member viewed within the hour, read beside the profile.
  const [profile, activities, site, relations] = await Promise.all([
    getProfile(userId),
    activitiesFor([userId]),
    getSite(),
    relationsFor(viewer.user?.id ?? null, [userId]),
  ]);
  const t = await getTranslations("members.profile");

  return (
    <>
      <JsonLd items={seoOf(profile, query).jsonLd} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingHeader")}>
            <ProfileHeaderSkeleton />
          </LoadingRegion>
        }
      >
        <ProfileHeader
          profile={profile}
          viewerId={viewer.user?.id ?? null}
          relation={relations(userId)}
          activity={activities.get(profile.id) ?? null}
          adult={adultMarked(site.adultMode, profile.isAdult)}
          manage={memberAdminTabs(viewer, profile.id)}
        />
      </Suspense>
      <TabSwitch
        place={placeOfQuery(query, PROFILE_TAB_PARAMS)}
        params={PROFILE_TAB_PARAMS}
        stamp={Date.now()}
        load={profileSections.bind(null, profile.id)}
      >
        <ProfileSections
          profile={profile}
          query={query}
          viewer={viewer}
          page={pageParam(query.page)}
        />
      </TabSwitch>
    </>
  );
}
