import { ListSkeleton } from "../groups/skeletons";
import { TrailLoading } from "../users/trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <ListSkeleton rows={6} />
    </TrailLoading>
  );
}
