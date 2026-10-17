import { LoadingPage, SignupsSkeleton } from "../skeletons";

export default function Loading() {
  return (
    <LoadingPage trail>
      <SignupsSkeleton />
    </LoadingPage>
  );
}
