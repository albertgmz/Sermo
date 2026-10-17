import { FormSkeleton } from "../../groups/skeletons";
import { TrailLoading } from "../../groups/trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <FormSkeleton rows={4} />
    </TrailLoading>
  );
}
