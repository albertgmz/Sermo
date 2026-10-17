import { FormSkeleton, LoadingPage } from "../../../skeletons";
import { ContentSkeleton } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <ContentSkeleton />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
