import { FormSkeleton } from "../../../groups/skeletons";
import { ForumsLoading } from "../../loading-page";

export default function Loading() {
  return (
    <ForumsLoading>
      <FormSkeleton rows={5} />
    </ForumsLoading>
  );
}
