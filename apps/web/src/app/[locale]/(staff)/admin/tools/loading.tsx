import { ContentSkeleton } from "../../moderation/skeletons";
import { LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <ContentSkeleton />
    </LoadingPage>
  );
}
