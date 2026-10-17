import { LoadingPage } from "../../../../skeletons";
import { FormSkeleton } from "../../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton rows={2} />
    </LoadingPage>
  );
}
