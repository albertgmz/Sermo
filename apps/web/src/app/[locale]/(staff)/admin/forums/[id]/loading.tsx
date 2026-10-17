import { FormSkeleton, ListSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={8} />
      <FormSkeleton rows={2} />
      <ListSkeleton />
    </LoadingPage>
  );
}
