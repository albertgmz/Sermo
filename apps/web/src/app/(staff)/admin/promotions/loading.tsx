import { FormSkeleton, ListSkeleton, LoadingPage } from "../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton />
      <FormSkeleton rows={4} />
    </LoadingPage>
  );
}
