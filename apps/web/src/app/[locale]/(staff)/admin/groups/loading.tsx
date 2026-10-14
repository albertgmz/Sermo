import { FormSkeleton, ListSkeleton, LoadingPage } from "./skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton />
      <FormSkeleton />
    </LoadingPage>
  );
}
