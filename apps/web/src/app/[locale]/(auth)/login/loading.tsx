import { AuthShellLoading } from "@/app/[locale]/(auth)/auth-shell";
import { FormRowSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AuthShellLoading page="login">
      <div className="space-y-4">
        <FormRowSkeleton />
        <div className="space-y-2">
          <FormRowSkeleton />
          <Skeleton className="h-10 w-36 md:h-5" />
        </div>
        <Skeleton className="h-10 w-32 md:h-5" />
        <Skeleton className="h-10 w-full md:h-8" />
      </div>
      <Skeleton className="mx-auto mt-4 h-10 w-56" />
    </AuthShellLoading>
  );
}
