import { LoadingPage, QueueSkeleton } from "../../moderation/skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <QueueSkeleton />
    </LoadingPage>
  );
}
