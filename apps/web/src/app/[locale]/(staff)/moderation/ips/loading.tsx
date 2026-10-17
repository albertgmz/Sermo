import { LoadingPage } from "../../skeletons";
import { ListSkeleton } from "../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={4} />
    </LoadingPage>
  );
}
