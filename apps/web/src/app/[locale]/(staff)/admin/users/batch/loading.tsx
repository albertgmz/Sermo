import { FormSkeleton } from "../../groups/skeletons";
import { TrailLoading } from "../trail-loading";

export default function Loading() {
  return (
    <TrailLoading>
      <FormSkeleton rows={3} />
    </TrailLoading>
  );
}
