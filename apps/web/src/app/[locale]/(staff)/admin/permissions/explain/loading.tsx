import { ListSkeleton, LoadingPage } from "../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ListSkeleton rows={3} />
    </LoadingPage>
  );
}
