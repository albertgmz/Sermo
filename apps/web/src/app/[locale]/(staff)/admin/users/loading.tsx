import { ListSkeleton } from "../groups/skeletons";
import { TrailLoading } from "./trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <ListSkeleton rows={8} />
    </TrailLoading>
  );
}
