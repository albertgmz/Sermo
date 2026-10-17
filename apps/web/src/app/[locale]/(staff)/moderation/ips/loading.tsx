import { ListSkeleton, LoadingPage } from "../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <ListSkeleton rows={4} />
    </LoadingPage>
  );
}
