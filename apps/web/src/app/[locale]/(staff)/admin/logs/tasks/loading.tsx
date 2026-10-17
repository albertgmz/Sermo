import { ContentSkeleton } from "../../../moderation/skeletons";
import { LoadingPage } from "../../../skeletons";

// The tasks screen is counts and a short list, not a filtered log.
export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
    </LoadingPage>
  );
}
