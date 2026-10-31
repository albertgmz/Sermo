import type { Metadata } from "next";
import {
  getProfile,
  memberIdOf,
  type Profile,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { profileHead } from "@/app/[locale]/(main)/members/[id]/profile-head";
import { ProfilePanel } from "@/app/[locale]/(main)/members/[id]/sections";
import { Wall } from "@/app/[locale]/(main)/members/[id]/wall";
import { JsonLd } from "@/components/forum/json-ld";
import { parseId } from "@/lib/sermo/ids";
import { copyOf } from "@/lib/sermo/seo";

type Query = Awaited<PageProps<"/[locale]/members/[id]">["searchParams"]>;

// The backend has one address for a profile, its wall; a continued list is a copy of it.
function seoOf(profile: Profile, query: Query) {
  const copy =
    query.cursor !== undefined ||
    query.pages !== undefined ||
    query.page !== undefined ||
    query.comments !== undefined ||
    query.commentsCursor !== undefined ||
    query.post !== undefined ||
    query.comment !== undefined;
  return copy ? copyOf(profile.seo) : profile.seo;
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps<"/[locale]/members/[id]">): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await getProfile(memberIdOf(id));
  return profileHead(profile, seoOf(profile, query));
}

// The wall: the profile's own page, under the header of the layout.
export default async function WallPage({
  params,
  searchParams,
}: PageProps<"/[locale]/members/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await getProfile(memberIdOf(id));
  const postId = Number(first(query.comments));
  const focusId = parseId(first(query.post) ?? "");
  const commentId = parseId(first(query.comment) ?? "");
  return (
    <>
      <JsonLd items={seoOf(profile, query).jsonLd} />
      <ProfilePanel profile={profile}>
        <Wall
          profile={profile}
          cursor={first(query.cursor)}
          pages={query.pages}
          open={
            Number.isSafeInteger(postId) && postId > 0
              ? { postId, cursor: first(query.commentsCursor) }
              : undefined
          }
          focus={
            focusId === null
              ? undefined
              : { postId: focusId, commentId: commentId ?? undefined }
          }
        />
      </ProfilePanel>
    </>
  );
}
