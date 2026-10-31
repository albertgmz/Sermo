import { useTranslations } from "next-intl";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

// The placeholder of the About tab: its card, then the profile's cards.
export default function Loading() {
  const t = useTranslations("members.profile");
  return (
    <LoadingRegion label={t("loadingDetails")}>
      <PageLayout>
        <div className="space-y-4">
          <CardSkeleton>
            <div className="px-4 py-3">
              <TextSkeleton />
            </div>
          </CardSkeleton>
          <div className="grid gap-4 md:grid-cols-2">
            <MemberListSkeleton rows={1} />
            <MemberListSkeleton rows={1} />
            <MemberListSkeleton />
          </div>
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
