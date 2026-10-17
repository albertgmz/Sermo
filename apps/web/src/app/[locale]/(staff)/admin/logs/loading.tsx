import { QueueSkeleton } from "../../moderation/skeletons";
import { LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <QueueSkeleton />
    </LoadingPage>
  );
}
