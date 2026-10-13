import { ContentSkeleton, LoadingPage } from "../../../moderation/skeletons";

// The tasks screen is counts and a short list, not a filtered log.
export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
    </LoadingPage>
  );
}
