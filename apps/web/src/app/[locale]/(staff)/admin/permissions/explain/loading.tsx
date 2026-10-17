import { ListSkeleton } from "../../groups/skeletons";
import { PermissionsLoading } from "../loading-page";

export default function Loading() {
  return (
    <PermissionsLoading>
      <ListSkeleton rows={3} />
    </PermissionsLoading>
  );
}
