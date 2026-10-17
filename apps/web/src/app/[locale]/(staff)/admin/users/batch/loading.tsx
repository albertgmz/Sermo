import { LoadingPage } from "../../../skeletons";
import { FormSkeleton } from "../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={3} />
    </LoadingPage>
  );
}
