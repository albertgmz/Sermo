import { FormSkeleton, LoadingPage } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={4} />
    </LoadingPage>
  );
}
