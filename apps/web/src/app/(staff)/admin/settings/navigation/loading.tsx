import {
  FormSkeleton,
  ListSkeleton,
  LoadingPage,
} from "../../groups/skeletons";

export default function Loading() {
  return (
    <LoadingPage>
      <FormSkeleton />
      <ListSkeleton rows={8} />
    </LoadingPage>
  );
}
