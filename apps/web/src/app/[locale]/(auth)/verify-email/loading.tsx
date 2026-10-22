import { AuthShellLoading } from "@/app/[locale]/(auth)/auth-shell";
import { FormRowSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AuthShellLoading page="verify">
      <div className="space-y-6">
        <Skeleton className="mx-auto h-10 w-full" />
        <div className="space-y-4">
          <FormRowSkeleton />
          <Skeleton className="h-10 w-full md:h-8" />
        </div>
      </div>
    </AuthShellLoading>
  );
}
