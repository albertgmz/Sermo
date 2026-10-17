import { ListSkeleton } from "../../../../skeletons";

// The member's log is a list of entries, not a form.
export default function Loading() {
  return <ListSkeleton rows={8} />;
}
