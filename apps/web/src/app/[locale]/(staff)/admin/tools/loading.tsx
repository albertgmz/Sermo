import { ContentSkeleton, LoadingPage } from "../../moderation/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <ContentSkeleton />
    </LoadingPage>
  );
}
