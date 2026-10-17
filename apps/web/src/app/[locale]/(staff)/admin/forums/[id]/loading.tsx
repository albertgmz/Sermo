import { LoadingPage } from "../../../skeletons";
import { FormSkeleton, ListSkeleton } from "../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={8} />
      <FormSkeleton rows={2} />
      <ListSkeleton />
    </LoadingPage>
  );
}
