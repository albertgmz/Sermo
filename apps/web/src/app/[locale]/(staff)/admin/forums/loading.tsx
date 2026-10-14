import { FormSkeleton, ListSkeleton, LoadingPage } from "../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={6} />
      <FormSkeleton />
    </LoadingPage>
  );
}
