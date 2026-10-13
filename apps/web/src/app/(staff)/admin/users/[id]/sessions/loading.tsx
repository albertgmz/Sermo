import { ListSkeleton } from "../../../groups/skeletons";

// The member's sessions are a list of blocks, not a form.
export default function Loading() {
  return <ListSkeleton rows={3} />;
}
