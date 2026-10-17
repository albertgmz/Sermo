import { LoadingPage, QueueSkeleton } from "../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <QueueSkeleton />
    </LoadingPage>
  );
}
