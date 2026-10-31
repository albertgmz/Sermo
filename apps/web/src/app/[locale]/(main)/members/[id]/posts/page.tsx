import { ActivityTab } from "@/app/[locale]/(main)/members/[id]/activity";
import {
  getProfile,
  memberIdOf,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { tabHead } from "@/app/[locale]/(main)/members/[id]/profile-head";
import { ProfilePanel } from "@/app/[locale]/(main)/members/[id]/sections";
import { pageParam } from "@/components/forum/page-window";

export const generateMetadata = ({
  params,
}: PageProps<"/[locale]/members/[id]/posts">) => tabHead(params, "posts");

// The member's posts in numbered pages, under the header of the layout.
export default async function PostsTab({
  params,
  searchParams,
}: PageProps<"/[locale]/members/[id]/posts">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const profile = await getProfile(memberIdOf(id));
  return (
    <ProfilePanel profile={profile}>
      <ActivityTab tab="posts" profile={profile} page={pageParam(query.page)} />
    </ProfilePanel>
  );
}
