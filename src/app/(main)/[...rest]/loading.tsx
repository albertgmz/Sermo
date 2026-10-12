import {
  HeadingSkeleton,
  LoadingRegion,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  return (
    <PageLayout>
      <LoadingRegion label="Loading page…">
        <HeadingSkeleton />
        <div className="mt-6">
          <TextSkeleton />
        </div>
      </LoadingRegion>
    </PageLayout>
  );
}
