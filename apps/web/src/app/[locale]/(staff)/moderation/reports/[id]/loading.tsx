import { LoadingPage } from "../../../skeletons";
import { ContentSkeleton, FormSkeleton } from "../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <ContentSkeleton />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
