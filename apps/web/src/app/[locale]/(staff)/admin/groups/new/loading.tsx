import { FormSkeleton } from "../skeletons";
import { TrailLoading } from "../trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <FormSkeleton />
    </TrailLoading>
  );
}
