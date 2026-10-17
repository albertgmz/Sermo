import { FormSkeleton, LoadingPage } from "../../../../skeletons";
import { ContentSkeleton } from "../../../skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <ContentSkeleton />
      <FormSkeleton rows={3} />
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
