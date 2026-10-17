import { ListSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={6} />
    </LoadingPage>
  );
}
