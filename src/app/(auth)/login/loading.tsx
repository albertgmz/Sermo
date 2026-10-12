import { FormRowSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { LogoMarkPlaceholder as LogoMark } from "@/components/layout/logo";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="grid min-h-dvh flex-1 md:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mx-auto flex size-12 items-center justify-center">
            <LogoMark className="size-9" />
          </div>
          <h1 className="mt-3 mb-8 text-center text-3xl font-bold tracking-tight">
            Welcome back
          </h1>
          <LoadingRegion label="Loading login…">
            <div className="space-y-4">
              <Skeleton className="h-10 w-full md:h-8" />
              <Skeleton className="mx-auto h-4 w-8" />
              <FormRowSkeleton />
              <div className="space-y-2">
                <FormRowSkeleton />
                <Skeleton className="h-10 w-36 md:h-5" />
              </div>
              <Skeleton className="h-10 w-32 md:h-5" />
              <Skeleton className="h-10 w-full md:h-8" />
            </div>
            <Skeleton className="mt-4 h-8 w-full" />
            <Skeleton className="mx-auto mt-4 h-10 w-56" />
          </LoadingRegion>
        </div>
      </div>
      <Skeleton className="hidden rounded-none md:block" />
    </main>
  );
}
