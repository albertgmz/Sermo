import { LoadingPage, QueueSkeleton } from "../../moderation/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <QueueSkeleton />
    </LoadingPage>
  );
}
