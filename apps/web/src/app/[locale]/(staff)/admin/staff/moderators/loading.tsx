import { ListSkeleton } from "../../groups/skeletons";
import { TrailLoading } from "../../groups/trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <ListSkeleton />
    </TrailLoading>
  );
}
