import {
  getProfile,
  memberIdOf,
} from "@/app/[locale]/(main)/members/[id]/profile";
import { tabHead } from "@/app/[locale]/(main)/members/[id]/profile-head";
import {
  About,
  StreamedCards,
} from "@/app/[locale]/(main)/members/[id]/sections";
import { PageLayout } from "@/components/layout/page-layout";
import { getViewer } from "@/lib/sermo/session";

export const generateMetadata = ({
  params,
}: PageProps<"/[locale]/members/[id]/about">) => tabHead(params, "about");

// What the member says about themselves, and their cards, under the header of the layout.
export default async function AboutTab({
  params,
}: PageProps<"/[locale]/members/[id]/about">) {
  const [{ id }, viewer] = await Promise.all([params, getViewer()]);
  const profile = await getProfile(memberIdOf(id));
  return (
    <PageLayout>
      <About
        profile={profile}
        isOwn={viewer.user?.id === profile.id}
        cards={<StreamedCards profile={profile} className="md:grid-cols-2" />}
      />
    </PageLayout>
  );
}
