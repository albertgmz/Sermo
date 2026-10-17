import { ContentSkeleton, FormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <ContentSkeleton />
      <FormSkeleton rows={3} />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
