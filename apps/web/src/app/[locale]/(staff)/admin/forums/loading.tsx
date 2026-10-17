import { ListSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={6} />
      <ListSkeleton rows={2} />
    </LoadingPage>
  );
}
