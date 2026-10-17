import { ListSkeleton } from "./skeletons";
import { TrailLoading } from "./trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <ListSkeleton />
    </TrailLoading>
  );
}
