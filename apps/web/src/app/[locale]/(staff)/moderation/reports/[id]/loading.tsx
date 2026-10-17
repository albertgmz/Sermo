import { ContentSkeleton, FormSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <ContentSkeleton />
      <ContentSkeleton />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
