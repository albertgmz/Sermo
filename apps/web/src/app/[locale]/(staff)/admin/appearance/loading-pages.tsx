import { FormSkeleton, ListSkeleton, LoadingPage } from "../../skeletons";

// The loading files of the appearance routes: the heading with its trail, then the skeleton of
// what settles (the rows of a list, or the form of an add or edit page).

export function ListLoading() {
  return (
    <LoadingPage>
      <ListSkeleton />
    </LoadingPage>
  );
}

export function FormLoading() {
  return (
    <LoadingPage>
      <FormSkeleton />
    </LoadingPage>
  );
}
