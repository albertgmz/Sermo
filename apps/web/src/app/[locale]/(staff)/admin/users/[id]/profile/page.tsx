import { profilesGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { call } from "@/lib/sermo/client";
import { adultReasonOfDigest, SermoError } from "@/lib/sermo/errors";
import { getSite } from "@/lib/sermo/site";
import { getMember, ifAllowed, isReadOnly, memberIdOf } from "../../data";
import { TabPage } from "../../tab-page";
import { ProfileForm } from "./profile-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminUsers.profile");
  return { title: t("metaTitle") };
}

async function Profile({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/users/[id]/profile">["params"];
  searchParams: PageProps<"/[locale]/admin/users/[id]/profile">["searchParams"];
}) {
  const userId = await memberIdOf(params);
  // A +18 refusal says the profile is marked, though its text cannot be read.
  const [member, read, site] = await Promise.all([
    getMember(userId),
    ifAllowed(() =>
      call(profilesGet, { userId }).then(
        (found) => ({ profile: found, adult: found.isAdult }),
        (error: unknown) => {
          if (error instanceof SermoError && adultReasonOfDigest(error.digest))
            return { profile: null, adult: true };
          throw error;
        },
      ),
    ),
    getSite(),
  ]);
  const profile = read?.profile ?? null;
  return (
    <>
      <Notice
        namespace="adminUsers.notices"
        searchParams={searchParams}
        shown={["saved"]}
      />
      <ProfileForm
        userId={userId}
        readOnly={isReadOnly(member)}
        adult={site.adultMode ? (read?.adult ?? null) : undefined}
        current={
          profile && {
            about: profile.about,
            location: profile.location,
            website: profile.website,
            customTitle: profile.customTitle,
          }
        }
      />
    </>
  );
}

export default function MemberProfilePage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/users/[id]/profile">) {
  const t = useTranslations("adminUsers.profile");
  return (
    <TabPage label={t("loading")} rows={6}>
      <Profile params={params} searchParams={searchParams} />
    </TabPage>
  );
}
