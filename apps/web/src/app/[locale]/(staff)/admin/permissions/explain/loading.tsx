import { ListSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={3} />
    </LoadingPage>
  );
}
