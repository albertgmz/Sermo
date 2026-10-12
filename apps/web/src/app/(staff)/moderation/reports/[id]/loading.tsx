import { ContentSkeleton, FormSkeleton, LoadingPage } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <ContentSkeleton />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
