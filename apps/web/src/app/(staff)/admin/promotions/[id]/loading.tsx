import { FormSkeleton, LoadingPage } from "../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={4} />
    </LoadingPage>
  );
}
