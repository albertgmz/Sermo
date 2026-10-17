import { ContentSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <ContentSkeleton />
    </LoadingPage>
  );
}
