import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import {
  getProfile,
  memberIdOf,
  type Profile,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { type ProfileTab, profileTabPath } from "@/lib/profile-tabs";
import { canonicalUrlOf } from "@/lib/sermo/addresses";
import { copyOf, type Seo, seoMetadata } from "@/lib/sermo/seo";
import { publicHead } from "@/lib/sermo/share";

// The head of a member's page with `seo`. Shared as the member's profile only when guests may see
// it (the backend indexes it).
export async function profileHead(
  profile: Profile,
  seo: Seo,
): Promise<Metadata> {
  const head = seoMetadata(seo);
  if (profile.seo.robots !== "index,follow") return head;
  return publicHead(head, {
    title: profile.username,
    card: { kind: "members", id: profile.id, seo: profile.seo },
    kind: { type: "profile", username: profile.username },
  });
}

// The head of a tab of a profile. The tab has its own address and its own title. As the tab of the
// old single page did, it stays out of the index and has no structured data (the wall is the
// profile's page), and a share of it is a share of the profile.
export async function tabHead(
  params: Promise<{ id: string }>,
  tab: ProfileTab,
): Promise<Metadata> {
  const { id } = await params;
  const [profile, t] = await Promise.all([
    getProfile(memberIdOf(id)),
    getTranslations("members.profile"),
  ]);
  const head = await profileHead(profile, copyOf(profile.seo));
  return {
    ...head,
    title: {
      absolute: t("tabTitle", {
        tab: t(`${tab}Tab`),
        title: profile.seo.title,
      }),
    },
    alternates: {
      ...head.alternates,
      canonical: profileTabPath(canonicalUrlOf(profile.seo.canonical), tab),
    },
  };
}
