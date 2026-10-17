import { FormSkeleton, ListSkeleton } from "../../groups/skeletons";
import { ForumsLoading } from "../loading-page";

export default function Loading() {
  return (
    <ForumsLoading>
      <FormSkeleton rows={8} />
      <FormSkeleton rows={2} />
      <ListSkeleton />
    </ForumsLoading>
  );
}
