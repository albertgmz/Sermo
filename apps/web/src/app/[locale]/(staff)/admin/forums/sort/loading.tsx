import { ListSkeleton } from "../../groups/skeletons";
import { ForumsLoading } from "../loading-page";

export default function Loading() {
  return (
    <ForumsLoading>
      <ListSkeleton rows={4} />
    </ForumsLoading>
  );
}
